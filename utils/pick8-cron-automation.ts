import { currentCronReadContext, withCronReadContext } from "@/utils/supabase/cron-read";
import "server-only";

import { createSyncDiagnostics } from "@/utils/pick8-sync-diagnostics";
import { competitionRefreshRequired } from "@/utils/pick8-sync-state";

import { NextResponse } from "next/server";
import { recalculateMatchdayScores, ScoringDeferredError } from "@/utils/pick8-scoring";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  syncWhoYouGotFixtures,
  type FixtureSyncSummary,
  type ExistingMatchdaySyncState,
} from "@/utils/who-you-got-fixture-sync";
import { refreshPick8Competitions } from "@/utils/pick8-competitions";
import {
  getFixtureAutomationPlan,
  type FixtureSyncMode,
} from "@/utils/pick8-fixture-sync-mode";
type Season = { id: string; name: string; provider_season: number;
  competition_refresh_pending: boolean; competition_revision: number;
  competition_refresh_after: string | null; lifecycle_recovery_due: boolean };
type Matchday = ExistingMatchdaySyncState & {
  matchday_number: number; fixture_sync_mode: FixtureSyncMode;
  provider_freshness_due: boolean; local_scoring_recovery_due: boolean;
  fixture_application_recovery_due: boolean; competition_lifecycle_recovery_due: boolean;
  due_reasons: string[];
};

type MatchdayFailure = { matchday: number; error: string };
type MatchdayRun = {
  matchday: number;
  sync: FixtureSyncSummary;
  recalculated: boolean;
  scoring?: Awaited<ReturnType<typeof recalculateMatchdayScores>>;
};

const inFlightMatchdays = new Set<string>();

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** Strict bearer authentication for the new Pick8 cron endpoints. */
export function authorizePick8Cron(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return jsonError("Cron authentication is not configured.", 500);

  const authorization = request.headers.get("authorization");
  if (!authorization) return jsonError("Authorization header is required.", 401);
  if (authorization !== `Bearer ${secret}`) {
    return jsonError("Cron authorization is invalid.", 403);
  }
  return null;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected automation failure.";
}

function logRun(fields: Record<string, unknown>) {
  console.info(JSON.stringify({ service: "pick8-cron", ...fields }));
}

function uniqueMatchdays(matchdays: Matchday[]) {
  return [...new Map(matchdays.map((matchday) => [matchday.id, matchday])).values()];
}

async function syncMatchday({
  route,
  season,
  matchday,
  recalculate,
}: {
  route: string;
  season: Season;
  matchday: Matchday;
  recalculate: "never" | "when-needed" | "always";
}): Promise<MatchdayRun | null> {
  const key = `${season.id}:${matchday.id}`;
  if (inFlightMatchdays.has(key)) return null;
  inFlightMatchdays.add(key);
  const startedAt = Date.now();
  try {
    const operation = recalculate === "never" ? "fixtures" : "results";
    const automationPlan = getFixtureAutomationPlan(
      matchday.fixture_sync_mode as "provider" | "manual",
      operation,
    );
    if (automationPlan === "skip") return null;
    if (automationPlan === "score_local_state") {
      const scoring = await recalculateMatchdayScores({
        seasonId: season.id,
        matchdayId: matchday.id,
      });
      return {
        matchday: matchday.matchday_number,
        sync: {
          season: season.provider_season,
          matchday: matchday.matchday_number,
          matchdayStatus: matchday.status,
          received: 0,
          inserted: 0,
          updated: 0,
          unchanged: 0,
          removed: 0,
          invalidatedEntries: 0,
          potentialRemovals: [],
          syncedAt: new Date().toISOString(),
        },
        recalculated: true,
        scoring,
      };
    }
    if (!matchday.provider_freshness_due && !matchday.fixture_application_recovery_due) {
      if (!matchday.local_scoring_recovery_due) return null;
      const scoring = await recalculateMatchdayScores({ seasonId: season.id, matchdayId: matchday.id, reuseAcknowledged: true });
      return { matchday: matchday.matchday_number, sync: {
        season: season.provider_season, matchday: matchday.matchday_number,
        matchdayStatus: scoring.matchdayStatus, received: matchday.fixture_count ?? 0,
        inserted: 0, updated: 0, unchanged: matchday.fixture_count ?? 0, removed: 0,
        invalidatedEntries: 0, potentialRemovals: [], syncedAt: new Date().toISOString(), fastPath: true,
      }, recalculated: !scoring.reused, scoring };
    }
    const sync = await syncWhoYouGotFixtures({
      season: season.provider_season,
      matchday: matchday.matchday_number,
      recalculateScores: recalculate !== "never",
      ...(!matchday.id.startsWith("pending:")
        ? { discovered: { seasonId: season.id, matchday } }
        : {}),
    });
    const scoring = sync.scoring;
    logRun({
      route,
      season: season.provider_season,
      matchday: matchday.matchday_number,
      durationMs: Date.now() - startedAt,
      success: true,
      received: sync.received,
      inserted: sync.inserted,
      updated: sync.updated,
      unchanged: sync.unchanged,
      removed: sync.removed,
      invalidatedEntries: sync.invalidatedEntries,
      potentialRemovals: sync.potentialRemovals.length,
      recalculated: Boolean(scoring && !scoring.reused),
      fastPath: sync.fastPath ?? false,
      dueReasons: matchday.due_reasons,
      providerCalls: 1,
      nextProviderCheckAt: sync.nextProviderCheckAt ?? null,
    });
    return { matchday: matchday.matchday_number, sync, recalculated: Boolean(scoring && !scoring.reused), scoring };
  } catch (error) {
    logRun({
      route,
      season: season.provider_season,
      matchday: matchday.matchday_number,
      durationMs: Date.now() - startedAt,
      success: false,
      error: safeError(error),
    });
    throw error;
  } finally {
    inFlightMatchdays.delete(key);
  }
}

async function runSelectedMatchdays({
  route,
  season,
  matchdays,
  recalculate,
}: {
  route: string;
  season: Season;
  matchdays: Matchday[];
  recalculate: "never" | "when-needed" | "always";
}) {
  const runs: MatchdayRun[] = [];
  const failures: MatchdayFailure[] = [];
  const deferred: Array<{ matchday: number; revision: number; reason: string }> = [];
  const skippedInFlight: number[] = [];
  for (const matchday of uniqueMatchdays(matchdays)) {
    try {
      const run = await syncMatchday({
        route,
        season,
        matchday,
        recalculate,
      });
      if (run) runs.push(run);
      else skippedInFlight.push(matchday.matchday_number);
    } catch (error) {
      if (error instanceof ScoringDeferredError) {
        deferred.push({ matchday: matchday.matchday_number, revision: error.revision, reason: error.message });
      } else {
        failures.push({ matchday: matchday.matchday_number, error: safeError(error) });
      }
    }
  }
  return { successes: runs, failures, deferred, skippedInFlight };
}

function totals(runs: MatchdayRun[]) {
  return runs.reduce(
    (total, run) => ({
      received: total.received + run.sync.received,
      inserted: total.inserted + run.sync.inserted,
      updated: total.updated + run.sync.updated,
      unchanged: total.unchanged + run.sync.unchanged,
      removed: total.removed + run.sync.removed,
      invalidatedEntries: total.invalidatedEntries + run.sync.invalidatedEntries,
      potentialRemovals: total.potentialRemovals + run.sync.potentialRemovals.length,
      recalculated: total.recalculated + Number(run.recalculated),
    }),
    { received: 0, inserted: 0, updated: 0, unchanged: 0, removed: 0, invalidatedEntries: 0, potentialRemovals: 0, recalculated: 0 },
  );
}

function operationalMetrics(result: Awaited<ReturnType<typeof runSelectedMatchdays>>) {
  const providerRuns = result.successes.filter((run) => run.sync.providerContentVersion !== undefined);
  return {
    providerCalls: providerRuns.length,
    fastPathCount: result.successes.filter((run) => run.sync.fastPath).length,
    scoringRpcCount: result.successes.filter((run) => run.scoring && !run.scoring.reused).length,
    localRecoveryOnlyCount: result.successes.filter((run) =>
      run.sync.providerContentVersion === undefined && Boolean(run.scoring)).length,
    changedFixtureCount: result.successes.reduce((count, run) =>
      count + run.sync.inserted + run.sync.updated + run.sync.removed, 0),
    deferredWorkCount: result.deferred.length,
    nextProviderCheckAt: providerRuns.map((run) => run.sync.nextProviderCheckAt)
      .filter((value): value is string => Boolean(value)).sort()[0] ?? null,
  };
}

function noActiveSeason(route: string, startedAt: number) {
  const result = {
    ok: true,
    skipped: true,
    reason: "No active season is configured.",
    durationMs: Date.now() - startedAt,
  };
  logRun({ route, ...result });
  return result;
}


type DiscoveryPolicy = "results" | "fixtures" | "reconciliation";
type DiscoveryPayload = { season: Record<string, unknown> | null; matchdays: Record<string, unknown>[]; dailyMatchdayNumbers?: number[] };

function mapDiscoveredMatchday(row: Record<string, unknown>): Matchday {
  return {
    id: String(row.id), matchday_number: Number(row.matchdayNumber), status: String(row.status),
    locks_at: row.locksAt as string | null, fixture_sync_mode: row.fixtureSyncMode as FixtureSyncMode,
    sync_pending: Boolean(row.fixtureApplicationPending), fixture_application_pending: Boolean(row.fixtureApplicationPending),
    scoring_pending: Boolean(row.scoringPending), sync_revision: Number(row.syncRevision),
    scoring_revision: Number(row.scoringRevision), scored_revision: row.scoredRevision == null ? null : Number(row.scoredRevision),
    applied_fixture_fingerprint: row.appliedFixtureFingerprint as string | null,
    provider_content_version: row.providerContentVersion as string | null,
    provider_content_fingerprint: row.providerContentFingerprint as string | null,
    next_provider_check_at: row.nextProviderCheckAt as string | null,
    terminal_fixture_fingerprint: row.terminalFixtureFingerprint as string | null,
    terminal_confirmed_at: row.terminalConfirmedAt as string | null,
    first_kickoff_at: row.firstKickoffAt as string | null, last_kickoff_at: row.lastKickoffAt as string | null,
    has_live_fixture: Boolean(row.hasLiveFixture), all_terminal: Boolean(row.allTerminal), fixture_count: Number(row.fixtureCount ?? 0),
    provider_freshness_due: Boolean(row.providerFreshnessDue), local_scoring_recovery_due: Boolean(row.localScoringRecoveryDue),
    fixture_application_recovery_due: Boolean(row.fixtureApplicationRecoveryDue),
    competition_lifecycle_recovery_due: Boolean(row.competitionLifecycleRecoveryDue),
    due_reasons: Array.isArray(row.dueReasons) ? row.dueReasons.map(String) : [],
  };
}

async function discover(route: string, policy: DiscoveryPolicy) {
  return createSyncDiagnostics({ route }).stage("discovery", async () => {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("discover_pick8_due_work", {
      check_policy: policy, check_now: new Date().toISOString(), check_limit: 12,
    });
    if (error) throw new Error(`Discovering due Pick 8 work failed: ${error.message}`);
    const payload = (data ?? {}) as unknown as DiscoveryPayload;
    const raw = payload.season;
    const season: Season | null = raw ? {
      id: String(raw.id), name: String(raw.name), provider_season: Number(raw.providerSeason),
      competition_refresh_pending: Boolean(raw.competitionRefreshPending),
      competition_revision: Number(raw.competitionRevision),
      competition_refresh_after: raw.competitionRefreshAfter as string | null,
      lifecycle_recovery_due: Boolean(raw.lifecycleRecoveryDue),
    } : null;
    const matchdays = (payload.matchdays ?? []).map(mapDiscoveredMatchday);
    createSyncDiagnostics({ route }).event({ service: "pick8-due-discovery", dbRequestCount: 1,
      dueMatchdays: matchdays.length, dueReasons: matchdays.map((row) => ({ matchday: row.matchday_number, reasons: row.due_reasons })) });
    return { season, matchdays, dailyMatchdayNumbers: payload.dailyMatchdayNumbers ?? [] };
  });
}

async function refreshAfterSync(route: string, season: Season, result: Awaited<ReturnType<typeof runSelectedMatchdays>>) {
  if (result.deferred.length && (currentCronReadContext()?.remaining() ?? Infinity) < 4_000) {
    return { deferred: true, reason: "Competition recovery retains its durable checkpoint." };
  }
  const changedOrRecovery = result.deferred.length > 0 || result.failures.length > 0 || result.successes.some((run) => !run.sync.fastPath);
  if (!changedOrRecovery && !competitionRefreshRequired(season)) {
    createSyncDiagnostics({ route, seasonId: season.id }).skipped("competition_refresh", "no_lifecycle_change_or_pending_recovery");
    return null;
  }
  return refreshPick8Competitions(season.id, { ifNeeded: true });
}

async function runDailyFixtureSyncInternal() {
  const route = "sync-fixtures";
  const startedAt = Date.now();
  const { season, matchdays, dailyMatchdayNumbers } = await discover(route, "fixtures");
  if (!season) return noActiveSeason(route, startedAt);
  const matchdayByNumber = new Map(
    matchdays.map((matchday) => [matchday.matchday_number, matchday]),
  );
  const selected = dailyMatchdayNumbers.map(
    (matchdayNumber): Matchday =>
      matchdayByNumber.get(matchdayNumber) ?? {
        id: `pending:${season.id}:${matchdayNumber}`,
        matchday_number: matchdayNumber,
        status: "upcoming",
        locks_at: null,
        fixture_sync_mode: "provider",
        sync_pending: false,
        fixture_application_pending: false,
        scoring_pending: false,
        sync_revision: 0,
        scoring_revision: 0,
        scored_revision: null,
        applied_fixture_fingerprint: null,
        provider_freshness_due: true,
        local_scoring_recovery_due: false,
        fixture_application_recovery_due: false,
        competition_lifecycle_recovery_due: season.lifecycle_recovery_due,
        due_reasons: ["daily_fixture_policy"],
      },
  );
  const result = await runSelectedMatchdays({ route, season, matchdays: selected, recalculate: "never" });
  const competitionRefresh = await refreshAfterSync(route, season, result);
  const response = {
    ok: result.failures.length === 0,
    complete: result.failures.length === 0 && result.deferred.length === 0,
    skipped: selected.length === 0,
    season: season.provider_season,
    matchdaysAttempted: selected.map((matchday) => matchday.matchday_number),
    ...result,
    totals: totals(result.successes),
    metrics: operationalMetrics(result),
    competitionRefresh,
    durationMs: Date.now() - startedAt,
  };
  logRun({ route, success: response.ok, matchdays: selected.length, durationMs: response.durationMs, ...response.metrics });
  return response;
}

async function runConditionalResultSyncInternal() {
  const route = "sync-results";
  const startedAt = Date.now();
  const { season, matchdays } = await discover(route, "results");
  if (!season) return noActiveSeason(route, startedAt);
  const selected = matchdays;
  const result = await runSelectedMatchdays({
    route,
    season,
    matchdays: selected,
    recalculate: "when-needed",
  });
  const competitionRefresh = await refreshAfterSync(route, season, result);
  const response = {
    ok: result.failures.length === 0,
    complete: result.failures.length === 0 && result.deferred.length === 0,
    skipped: selected.length === 0,
    reason: selected.length === 0 ? "No matchday currently needs a result check." : undefined,
    season: season.provider_season,
    matchdaysAttempted: selected.map((matchday) => matchday.matchday_number),
    ...result,
    totals: totals(result.successes),
    metrics: operationalMetrics(result),
    competitionRefresh,
    durationMs: Date.now() - startedAt,
  };
  logRun({ route, success: response.ok, matchdays: selected.length, durationMs: response.durationMs, ...response.metrics });
  return response;
}

async function runResultReconciliationInternal() {
  const route = "reconcile-results";
  const startedAt = Date.now();
  const { season, matchdays } = await discover(route, "reconciliation");
  if (!season) return noActiveSeason(route, startedAt);
  const selected = matchdays;
  const result = await runSelectedMatchdays({
    route,
    season,
    matchdays: selected,
    recalculate: "always",
  });
  const competitionRefresh = await refreshAfterSync(route, season, result);
  const response = {
    ok: result.failures.length === 0,
    complete: result.failures.length === 0 && result.deferred.length === 0,
    skipped: selected.length === 0,
    reason: selected.length === 0 ? "No recent or scoring matchday needs reconciliation." : undefined,
    season: season.provider_season,
    reconciliationPolicy: "due recovery plus previous two UTC days",
    matchdaysAttempted: selected.map((matchday) => matchday.matchday_number),
    ...result,
    totals: totals(result.successes),
    metrics: operationalMetrics(result),
    competitionRefresh,
    durationMs: Date.now() - startedAt,
  };
  logRun({ route, success: response.ok, matchdays: selected.length, durationMs: response.durationMs, ...response.metrics });
  return response;
}

export async function runDailyFixtureSync() {
  const diagnostics = createSyncDiagnostics({ operation: "runDailyFixtureSync" });
  return diagnostics.stage("total", () => withCronReadContext(() => runDailyFixtureSyncInternal()));
}

export async function runConditionalResultSync() {
  const diagnostics = createSyncDiagnostics({ operation: "runConditionalResultSync" });
  return diagnostics.stage("total", () => withCronReadContext(() => runConditionalResultSyncInternal()));
}

export async function runResultReconciliation() {
  const diagnostics = createSyncDiagnostics({ operation: "runResultReconciliation" });
  return diagnostics.stage("total", () => withCronReadContext(() => runResultReconciliationInternal()));
}
