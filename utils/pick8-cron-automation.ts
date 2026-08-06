import "server-only";

import { NextResponse } from "next/server";
import type { Tables } from "@/types/database.types";
import { recalculateMatchdayScores } from "@/utils/pick8-scoring";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  syncWhoYouGotFixtures,
  type FixtureSyncSummary,
} from "@/utils/who-you-got-fixture-sync";

type Season = Pick<Tables<"seasons">, "id" | "name" | "provider_season">;
type Matchday = Pick<
  Tables<"matchdays">,
  "id" | "matchday_number" | "status" | "locks_at"
>;
type Fixture = Pick<Tables<"fixtures">, "matchday_id" | "kickoff_at" | "status">;

type MatchdayFailure = { matchday: number; error: string };
type MatchdayRun = {
  matchday: number;
  sync: FixtureSyncSummary;
  recalculated: boolean;
  scoring?: Awaited<ReturnType<typeof recalculateMatchdayScores>>;
};

const LIVE_STATUSES = new Set(["in_play", "paused"]);
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

async function loadActiveSeason() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("seasons")
    .select("id, name, provider_season")
    .eq("is_active", true)
    .order("provider_season", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Loading the active season failed: ${error.message}`);
  return (data ?? null) as Season | null;
}

async function loadMatchdays(seasonId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("matchdays")
    .select("id, matchday_number, status, locks_at")
    .eq("season_id", seasonId)
    .order("matchday_number", { ascending: true });
  if (error) throw new Error(`Loading matchdays failed: ${error.message}`);
  return (data ?? []) as Matchday[];
}

async function loadFixtures(matchdayIds: string[]) {
  if (matchdayIds.length === 0) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("fixtures")
    .select("matchday_id, kickoff_at, status")
    .in("matchday_id", matchdayIds);
  if (error) throw new Error(`Loading fixtures failed: ${error.message}`);
  return (data ?? []) as Fixture[];
}

function uniqueMatchdays(matchdays: Matchday[]) {
  return [...new Map(matchdays.map((matchday) => [matchday.id, matchday])).values()];
}

async function syncMatchday({
  route,
  season,
  matchday,
  recalculate,
  forceRecalculate = false,
}: {
  route: string;
  season: Season;
  matchday: Matchday;
  recalculate: "never" | "when-needed" | "always";
  forceRecalculate?: boolean;
}): Promise<MatchdayRun | null> {
  const key = `${season.id}:${matchday.id}`;
  if (inFlightMatchdays.has(key)) return null;
  inFlightMatchdays.add(key);
  const startedAt = Date.now();
  try {
    const sync = await syncWhoYouGotFixtures({
      season: season.provider_season,
      matchday: matchday.matchday_number,
    });
    const providerChanged = sync.inserted + sync.updated > 0;
    const shouldRecalculate =
      recalculate === "always" ||
      (recalculate === "when-needed" &&
        (providerChanged ||
          forceRecalculate ||
          matchday.status === "scoring" ||
          sync.matchdayStatus === "completed"));
    const scoring = shouldRecalculate
      ? await recalculateMatchdayScores({ seasonId: season.id, matchdayId: matchday.id })
      : undefined;
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
      potentialRemovals: sync.potentialRemovals.length,
      recalculated: Boolean(scoring),
    });
    return { matchday: matchday.matchday_number, sync, recalculated: Boolean(scoring), scoring };
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
  forceRecalculateMatchdayIds = new Set<string>(),
}: {
  route: string;
  season: Season;
  matchdays: Matchday[];
  recalculate: "never" | "when-needed" | "always";
  forceRecalculateMatchdayIds?: Set<string>;
}) {
  const runs: MatchdayRun[] = [];
  const failures: MatchdayFailure[] = [];
  const skippedInFlight: number[] = [];
  for (const matchday of uniqueMatchdays(matchdays)) {
    try {
      const run = await syncMatchday({
        route,
        season,
        matchday,
        recalculate,
        forceRecalculate: forceRecalculateMatchdayIds.has(matchday.id),
      });
      if (run) runs.push(run);
      else skippedInFlight.push(matchday.matchday_number);
    } catch (error) {
      failures.push({ matchday: matchday.matchday_number, error: safeError(error) });
    }
  }
  return { successes: runs, failures, skippedInFlight };
}

function totals(runs: MatchdayRun[]) {
  return runs.reduce(
    (total, run) => ({
      received: total.received + run.sync.received,
      inserted: total.inserted + run.sync.inserted,
      updated: total.updated + run.sync.updated,
      unchanged: total.unchanged + run.sync.unchanged,
      potentialRemovals: total.potentialRemovals + run.sync.potentialRemovals.length,
      recalculated: total.recalculated + Number(run.recalculated),
    }),
    { received: 0, inserted: 0, updated: 0, unchanged: 0, potentialRemovals: 0, recalculated: 0 },
  );
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

export async function runDailyFixtureSync() {
  const route = "sync-fixtures";
  const startedAt = Date.now();
  const season = await loadActiveSeason();
  if (!season) return noActiveSeason(route, startedAt);
  const matchdays = await loadMatchdays(season.id);
  const useful = matchdays.filter((matchday) =>
    ["open", "scoring"].includes(matchday.status),
  );
  const nextUpcoming = matchdays.filter((matchday) => matchday.status === "upcoming").slice(0, 3);
  const selected = uniqueMatchdays([...useful, ...nextUpcoming]);
  const result = await runSelectedMatchdays({ route, season, matchdays: selected, recalculate: "never" });
  const response = {
    ok: result.failures.length === 0,
    skipped: selected.length === 0,
    season: season.provider_season,
    matchdaysAttempted: selected.map((matchday) => matchday.matchday_number),
    ...result,
    totals: totals(result.successes),
    durationMs: Date.now() - startedAt,
  };
  logRun({ route, success: response.ok, matchdays: selected.length, durationMs: response.durationMs });
  return response;
}

export async function runConditionalResultSync() {
  const route = "sync-results";
  const startedAt = Date.now();
  const season = await loadActiveSeason();
  if (!season) return noActiveSeason(route, startedAt);
  const matchdays = await loadMatchdays(season.id);
  const fixtures = await loadFixtures(matchdays.map((matchday) => matchday.id));
  const now = Date.now();
  const windowStart = now - 4 * 60 * 60 * 1000;
  const windowEnd = now + 30 * 60 * 1000;
  const fixturesByMatchday = Map.groupBy(fixtures, (fixture) => fixture.matchday_id);
  const finalReconciliationMatchdayIds = new Set(
    matchdays
      .filter(
        (matchday) =>
          matchday.status !== "completed" &&
          (fixturesByMatchday.get(matchday.id) ?? []).some(
            (fixture) => fixture.status === "finished",
          ),
      )
      .map((matchday) => matchday.id),
  );
  const selected = matchdays.filter((matchday) => {
    if (matchday.status === "scoring") return true;
    return (fixturesByMatchday.get(matchday.id) ?? []).some((fixture) => {
      const kickoff = Date.parse(fixture.kickoff_at);
      return (
        LIVE_STATUSES.has(fixture.status) ||
        (fixture.status === "finished" && matchday.status !== "completed") ||
        (Number.isFinite(kickoff) && kickoff >= windowStart && kickoff <= windowEnd)
      );
    });
  });
  const result = await runSelectedMatchdays({
    route,
    season,
    matchdays: selected,
    recalculate: "when-needed",
    forceRecalculateMatchdayIds: finalReconciliationMatchdayIds,
  });
  const response = {
    ok: result.failures.length === 0,
    skipped: selected.length === 0,
    reason: selected.length === 0 ? "No matchday currently needs a result check." : undefined,
    season: season.provider_season,
    matchdaysAttempted: selected.map((matchday) => matchday.matchday_number),
    ...result,
    totals: totals(result.successes),
    durationMs: Date.now() - startedAt,
  };
  logRun({ route, success: response.ok, matchdays: selected.length, durationMs: response.durationMs });
  return response;
}

export async function runResultReconciliation() {
  const route = "reconcile-results";
  const startedAt = Date.now();
  const season = await loadActiveSeason();
  if (!season) return noActiveSeason(route, startedAt);
  const matchdays = await loadMatchdays(season.id);
  const fixtures = await loadFixtures(matchdays.map((matchday) => matchday.id));
  const now = new Date();
  const startUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2);
  const endUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const recentMatchdayIds = new Set(
    fixtures
      .filter((fixture) => {
        const kickoff = Date.parse(fixture.kickoff_at);
        return Number.isFinite(kickoff) && kickoff >= startUtc && kickoff < endUtc;
      })
      .map((fixture) => fixture.matchday_id),
  );
  const selected = matchdays.filter(
    (matchday) => matchday.status === "scoring" || recentMatchdayIds.has(matchday.id),
  );
  const result = await runSelectedMatchdays({
    route,
    season,
    matchdays: selected,
    recalculate: "always",
  });
  const response = {
    ok: result.failures.length === 0,
    skipped: selected.length === 0,
    reason: selected.length === 0 ? "No recent or scoring matchday needs reconciliation." : undefined,
    season: season.provider_season,
    reconciliationWindowStartUtc: new Date(startUtc).toISOString(),
    matchdaysAttempted: selected.map((matchday) => matchday.matchday_number),
    ...result,
    totals: totals(result.successes),
    durationMs: Date.now() - startedAt,
  };
  logRun({ route, success: response.ok, matchdays: selected.length, durationMs: response.durationMs });
  return response;
}
