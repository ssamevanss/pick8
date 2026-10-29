import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type * as SyncModule from "../../utils/who-you-got-fixture-sync";
import type * as CronModule from "../../utils/pick8-cron-automation";

// Exercise the real server orchestration with a deterministic REST-shaped store.
// Production imports are transpiled in memory; no application files are emitted.
type Row = Record<string, unknown>;
export type Call = { table: string; operation: string; values?: Row };
export type HarnessOptions = {
  providerSeason?: number; matchdayNumber?: number; now?: string;
  /** Adjusts the seeded tables before the default upstream payload is derived from them. */
  seed?: (tables: Record<string, Row[]>) => void;
};
export function harness({ providerSeason = 2026, matchdayNumber = 5, now: start = "2026-09-13T12:00:00Z", seed }: HarnessOptions = {}) {
  let now = Date.parse(start);
  class ClockDate extends Date {
    constructor(value?: string | number) { super(value ?? now); }
    static now() { return now; }
  }
  const tables: Record<string, Row[]> = {
    seasons: [{ id: "season", name: "2026/27", provider_season: 2026, is_active: true, competition_refresh_pending: false, competition_revision: 0, competition_refresh_after: null }],
    matchdays: [{ id: "matchday", season_id: "season", matchday_number: 5, fixture_sync_mode: "provider", status: "completed", locks_at: "2026-09-13T10:00:00.000Z", sync_pending: false, fixture_application_pending: false, scoring_pending: false, sync_revision: 0, scoring_revision: 0, applied_fixture_fingerprint: null, next_provider_check_at: null, provider_content_version: null, provider_content_fingerprint: null, terminal_fixture_fingerprint: null, terminal_confirmed_at: null, is_accelerated_test: false }],
    fixtures: Array.from({ length: 10 }, (_, i) => ({
      id: `fixture-${i}`, matchday_id: "matchday", external_fixture_id: String(i + 100),
      home_team_id: i * 2 + 1, away_team_id: i * 2 + 2, home_team_name: `Home ${i}`, away_team_name: `Away ${i}`,
      home_team_crest_url: null, away_team_crest_url: null, kickoff_at: "2026-09-13T10:00:00.000Z", status: "finished", home_score: 2, away_score: 1,
      last_synced_at: "old-check",
    })),
    entries: Array.from({ length: 10 }, (_, i) => ({ id: `entry-${i}`, matchday_id: "matchday", submitted_at: "2026-09-12T00:00:00Z", total_goals_prediction: 30 })),
    entry_selections: Array.from({ length: 70 }, (_, i) => ({ id: `selection-${i}`, entry_id: `entry-${Math.floor(i / 7)}`, category: "home_win", fixture_id: `fixture-${i % 7}`, selected_team_side: "home" })),
    competitions: Array.from({ length: 8 }, (_, i) => ({ id: `competition-${i}`, season_id: "season", name: `Competition ${i + 1}`, start_matchday: i * 5 + 1, end_matchday: Math.min(i * 5 + 5, 38), status: i === 0 ? "active" : "upcoming" })),
  };
  const calls: Call[] = [];
  const logs: Row[] = [];
  let upstreamCalls = 0;
  let providerEtag: string | null = null;
  let rpcErrorCode: string | undefined;
  let fail: ((call: Call) => boolean) | undefined;
  let ambiguous: ((call: Call) => boolean) | undefined;
  let before: ((call: Call) => void) | undefined;
  seed?.(tables);
  let respond: (() => Response) | undefined;
  let upstream = providerPayload();
  function providerPayload() {
    return { matchday: matchdayNumber, fixtures: tables.fixtures.map((f) => ({ ...f, homeTeamCrestUrl: f.home_team_crest_url, awayTeamCrestUrl: f.away_team_crest_url })) };
  }
  function dirty(scoring = true) {
    const state = tables.matchdays[0];
    state.sync_revision = Number(state.sync_revision) + 1;
    state.sync_pending = true;
    state.fixture_application_pending = true;
    if (scoring) { state.scoring_revision = Number(state.scoring_revision) + 1; state.scoring_pending = true; }
  }
  function localDirty() {
    const state = tables.matchdays[0];
    state.scoring_revision = Number(state.scoring_revision) + 1;
    state.scoring_pending = true;
  }
  function changed(table: string, old: Row | undefined, row: Row) {
    if (table === "fixtures" && JSON.stringify(old) !== JSON.stringify(row)) dirty();
    if (table === "matchdays" && old && ["status", "locks_at", "fixture_sync_mode"].some((key) => old[key] !== row[key])) {
      dirty(old.locks_at !== row.locks_at || old.fixture_sync_mode !== row.fixture_sync_mode);
      tables.seasons[0].competition_refresh_pending = true;
      tables.seasons[0].competition_revision = Number(tables.seasons[0].competition_revision) + 1;
    }
  }
  function from(table: string) {
    let operation = "select";
    let values: Row | Row[] | undefined;
    let single = false;
    const filters: Array<(row: Row) => boolean> = [];
    const builder = {
      get method() { return operation === "select" ? "GET" : "PATCH"; },
      url: new URL(`https://example.test/rest/v1/${table}`),
      retry(enabled: boolean) { assert.equal(enabled, false); return builder; },
      abortSignal() { return builder; },
      select() { return builder; },
      update(value: Row) { operation = "update"; values = value; return builder; },
      insert(value: Row | Row[]) { operation = "insert"; values = value; return builder; },
      upsert(value: Row) { operation = "upsert"; values = value; return builder; },
      delete() { operation = "delete"; return builder; },
      eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return builder; },
      is(key: string, value: unknown) { filters.push((row) => (row[key] ?? null) === value); return builder; },
      not(key: string, _operator: string, value: unknown) { filters.push((row) => (row[key] ?? null) !== value); return builder; },
      in(key: string, value: unknown[]) {
        filters.push((row) => value.includes(key === "fixtures.external_fixture_id" ? tables.fixtures.find((f) => f.id === row.fixture_id)?.external_fixture_id : row[key])); return builder;
      },
      order() { return builder; }, limit() { return builder; },
      maybeSingle() { single = true; return builder; }, single() { single = true; return builder; },
      then(onfulfilled: (result: { data: Row | Row[] | null; error: { message: string } | null }) => unknown) {
        const call = { table, operation, values: Array.isArray(values) ? undefined : values };
        calls.push(call);
        before?.(call);
        if (fail?.(call)) return Promise.resolve(onfulfilled({ data: null, error: { message: "injected failure" } }));
        let rows = tables[table].filter((row) => filters.every((filter) => filter(row)));
        if (operation === "upsert") {
          if (Array.isArray(values)) {
            rows = values.map((value) => tables[table].find((row) => row.id === value.id) ?? value);
          } else {
            rows = tables[table].filter((row) => row.season_id === values!.season_id && row.matchday_number === values!.matchday_number);
            if (!rows.length) { const row = { id: "matchday", ...values }; tables[table].push(row); rows = [row]; }
          }
        }
        if (operation === "update" || operation === "upsert") {
          for (const [index, row] of rows.entries()) { const old = { ...row }; Object.assign(row, Array.isArray(values) ? values[index] : values); changed(table, old, row); }
        }
        if (operation === "insert") {
          rows = (Array.isArray(values) ? values : [values!]).map((row, i) => ({ id: `insert-${i}`, ...row }));
          tables[table].push(...rows); for (const row of rows) changed(table, undefined, row);
        }
        if (operation === "delete") {
          tables[table] = tables[table].filter((row) => !rows.includes(row));
          if (table === "fixtures" && rows.length) dirty();
        }
        const data = JSON.parse(JSON.stringify(single ? rows[0] ?? null : rows));
        if (ambiguous?.(call)) return Promise.resolve(onfulfilled({ data: null, error: { message: "Gateway Timeout", code: "", details: "upstream", hint: "" }, status: 504 } as never));
        return Promise.resolve(onfulfilled({ data, error: null }));
      },
    };
    return builder;
  }
  function rpc(name: string, args: Record<string, unknown>) {
    const builder = {
      retry(enabled: boolean) { assert.equal(enabled, false); return builder; },
      abortSignal() { return builder; },
      then(resolve: (value: unknown) => unknown) {
        const call = { table: name === "discover_pick8_due_work" ? "discovery_rpc" : "rpc", operation: "rpc", values: args };
        calls.push(call); before?.(call);
        if (name === "discover_pick8_due_work") {
          const season = tables.seasons[0];
          const policy = String(args.check_policy ?? "results");
          const providerIsDue = (md: Row) => {
            const fixtures = tables.fixtures.filter((fixture) => fixture.matchday_id === md.id);
            const lastKickoff = Math.max(...fixtures.map((fixture) => Date.parse(String(fixture.kickoff_at))));
            return md.fixture_sync_mode === "provider" &&
              (md.next_provider_check_at != null ? Date.parse(String(md.next_provider_check_at)) <= now :
                md.status === "scoring" || fixtures.some(f => ["in_play", "paused"].includes(String(f.status))) ||
                (Number.isFinite(lastKickoff) && lastKickoff >= now - 4 * 60 * 60_000 && lastKickoff <= now + 30 * 60_000) ||
                (md.status === "completed" && md.applied_fixture_fingerprint == null && lastKickoff >= now - 2 * 24 * 60 * 60_000));
          };
          const due = tables.matchdays.filter((md) => {
            const providerDue = providerIsDue(md);
            if (policy === "fixtures" || policy === "reconciliation") return true;
            return providerDue || Boolean(md.scoring_pending || md.fixture_application_pending || md.sync_pending);
          }).map((md) => {
            const fixtures = tables.fixtures.filter((fixture) => fixture.matchday_id === md.id);
            const allTerminal = fixtures.length > 0 && fixtures.every((fixture) => ["finished", "postponed", "cancelled"].includes(String(fixture.status)));
            const providerDue = policy !== "results" || providerIsDue(md);
            return { id: md.id, matchdayNumber: md.matchday_number, status: md.status, locksAt: md.locks_at,
              fixtureSyncMode: md.fixture_sync_mode, syncRevision: md.sync_revision, scoringRevision: md.scoring_revision,
              scoredRevision: md.scored_revision ?? null, appliedFixtureFingerprint: md.applied_fixture_fingerprint,
              fixtureApplicationPending: Boolean(md.fixture_application_pending || md.sync_pending), scoringPending: Boolean(md.scoring_pending),
              nextProviderCheckAt: md.next_provider_check_at ?? null, providerContentVersion: md.provider_content_version ?? null,
              providerContentFingerprint: md.provider_content_fingerprint ?? null,
              terminalFixtureFingerprint: md.terminal_fixture_fingerprint ?? null, terminalConfirmedAt: md.terminal_confirmed_at ?? null,
              fixtureCount: fixtures.length, firstKickoffAt: fixtures.map(f => f.kickoff_at).sort()[0] ?? null,
              lastKickoffAt: fixtures.map(f => f.kickoff_at).sort().at(-1) ?? null,
              hasLiveFixture: fixtures.some(f => ["in_play", "paused"].includes(String(f.status))), allTerminal,
              providerFreshnessDue: providerDue, localScoringRecoveryDue: Boolean(md.scoring_pending),
              fixtureApplicationRecoveryDue: Boolean(md.fixture_application_pending || md.sync_pending),
              competitionLifecycleRecoveryDue: Boolean(season.competition_refresh_pending),
              dueReasons: [providerDue ? "provider_freshness" : null, md.scoring_pending ? "local_scoring_recovery" : null].filter(Boolean) };
          });
          return Promise.resolve(resolve({ data: { season: { id: season.id, name: season.name, providerSeason: season.provider_season,
            competitionRefreshPending: season.competition_refresh_pending, competitionRevision: season.competition_revision,
            competitionRefreshAfter: season.competition_refresh_after, lifecycleRecoveryDue: season.competition_refresh_pending },
            matchdays: due, dailyMatchdayNumbers: policy === "fixtures" ? due.map(md => md.matchdayNumber) : [] }, error: null }));
        }
        if (rpcErrorCode) return Promise.resolve(resolve({ data: null, error: { message: "transaction rolled back", code: rpcErrorCode }, status: 400 }));
        if (fail?.(call)) return Promise.resolve(resolve({ data: null, error: { message: "injected failure" } }));
        const md = tables.matchdays[0];
        if (md.scoring_revision !== args.check_scoring_revision) return Promise.resolve(resolve({ data: null, error: { message: "Scoring inputs changed during calculation" } }));
        const scorer = load<typeof import("../../utils/pick8-scoring")>("utils/pick8-scoring.ts");
        const fixtures = tables.fixtures as unknown as import("../../utils/pick8-scoring").ScoringFixture[];
        const fixtureMap = new Map(fixtures.map(f => [f.id, f]));
        const finalReady = scorer.isMatchdayReadyForFinalScoring(fixtures);
        const entries = tables.entries.filter(e => e.submitted_at != null);
        let selectionRowsChanged = 0, entryRowsChanged = 0, selectionsScored = 0, selectionRowsConsidered = 0;
        for (const entry of tables.entries) {
          const picks = tables.entry_selections.filter(s => s.entry_id === entry.id);
          const result = scorer.scoreEntry({ selections: picks as never, fixturesById: fixtureMap,
            totalGoalsPrediction: entry.total_goals_prediction as number | null, finalScoringReady: finalReady,
            completedGoalTotal: scorer.calculateCompletedMatchdayGoalTotal(fixtures) });
          if (entry.submitted_at != null) for (const selection of result.selectionScores) {
            const row = tables.entry_selections.find(s => s.id === selection.id)!;
            selectionRowsConsidered++; if (selection.pointsAwarded !== null) selectionsScored++;
            if ((row.points_awarded ?? null) !== selection.pointsAwarded || (row.is_correct ?? null) !== selection.isCorrect) selectionRowsChanged++;
            Object.assign(row, { points_awarded: selection.pointsAwarded, is_correct: selection.isCorrect });
          }
          const score = entry.submitted_at != null ? result.calculatedScore : null;
          if ((entry.calculated_score ?? null) !== score) entryRowsChanged++;
          entry.calculated_score = score;
        }
        const lifecycle = load<typeof import("../../utils/pick8-fixture-state")>("utils/pick8-fixture-state.ts")
          .resolveMatchdayScoringStatus({ currentStatus: String(md.status), fixtures, finalScoringReady: finalReady, now });
        const old = { ...md }; md.status = lifecycle; changed("matchdays", old, md);
        const result = { seasonId: "season", matchdayId: "matchday", matchdayNumber: md.matchday_number,
          entriesFound: entries.length, selectionsScored, selectionsAwaitingResults: selectionRowsConsidered - selectionsScored,
          voidSelections: 0, entriesFinalized: finalReady ? entries.length : 0, entriesSkipped: finalReady ? 0 : entries.length,
          finalScoringReady: finalReady, recalculatedAt: new ClockDate().toISOString(), matchdayStatus: lifecycle,
          requestedScoringRevision: args.check_scoring_revision, acknowledgedRevision: args.check_scoring_revision,
          selectionRowsConsidered, selectionRowsChanged, entryRowsConsidered: tables.entries.length, entryRowsChanged, reused: false };
        Object.assign(md, { scoring_pending: false, scored_revision: args.check_scoring_revision, scoring_result: result });
        return Promise.resolve(resolve(ambiguous?.(call)
          ? { data: null, error: { message: "gateway response lost" }, status: 504 }
          : { data: result, error: null, status: 200 }));
      },
    };
    return builder;
  }
  const nativeRequire = createRequire(import.meta.url);
  const modules = new Map<string, unknown>();
  function load<T>(name: string): T {
    const path = resolve(name);
    if (modules.has(path)) return modules.get(path) as T;
    const exports = {};
    const loadedModule = { exports };
    modules.set(path, exports);
    const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const require = (id: string): unknown => {
      if (id === "server-only") return {};
      if (id === "@/utils/supabase/admin") return { createAdminClient: () => ({ from, rpc }) };
      if (id === "next/server") return { NextResponse: Response };
      if (id.startsWith("@/")) return load(`${id.slice(2)}.ts`);
      if (id.startsWith(".")) return load(resolve(dirname(path), id.endsWith(".ts") ? id : `${id}.ts`));
      return nativeRequire(id);
    };
    runInNewContext(source, {
      exports, module: loadedModule, require, Date: ClockDate, Map, Set, URL, AbortSignal, performance, setTimeout, clearTimeout, crypto: globalThis.crypto,
      process: { env: { WHO_YOU_GOT_API_URL: "https://example.test", WHO_YOU_GOT_API_KEY: "test" } },
      console: { info: (value: string) => logs.push(JSON.parse(value)), error: () => {} },
      fetch: async (_input: unknown, init?: RequestInit) => {
        upstreamCalls++;
        if (respond) return respond();
        const ifNoneMatch = new Headers(init?.headers).get("if-none-match");
        if (providerEtag && ifNoneMatch === providerEtag) return new Response(null, { status: 304, headers: { etag: providerEtag } });
        return Response.json(upstream, { headers: providerEtag ? { etag: providerEtag } : undefined });
      },
    }, { filename: path });
    return loadedModule.exports as T;
  }
  const sync = load<typeof SyncModule>("utils/who-you-got-fixture-sync.ts");
  const cron = load<typeof CronModule>("utils/pick8-cron-automation.ts");
  return {
    tables, calls, logs, dirty, localDirty, sync: () => sync.syncWhoYouGotFixtures({ season: providerSeason, matchday: matchdayNumber, recalculateScores: true }),
    fixtureOnly: () => sync.syncWhoYouGotFixtures({ season: providerSeason, matchday: matchdayNumber }),
    cron: () => cron.runConditionalResultSync(), daily: () => cron.runDailyFixtureSync(),
    reconcile: () => cron.runResultReconciliation(),
    upstreamCalls: () => upstreamCalls,
    etag: (value: string | null) => { providerEtag = value; },
    rpcError: (code: string) => { rpcErrorCode = code; },
    ambiguous: (handler?: (call: Call) => boolean) => { ambiguous = handler; },
    fail: (handler?: (call: Call) => boolean) => { fail = handler; },
    before: (handler?: (call: Call) => void) => { before = handler; },
    limitBudget: (remaining: number) => {
      const context = load<typeof import("../../utils/supabase/cron-read")>("utils/supabase/cron-read.ts").currentCronReadContext();
      if (context) context.remaining = () => remaining;
    },
    upstream: () => upstream,
    resetUpstream: () => { upstream = providerPayload(); },
    setUpstream: (value: unknown) => { upstream = value as typeof upstream; },
    respond: (handler?: () => Response) => { respond = handler; },
    load,
    clock: (value: string) => { now = Date.parse(value); },
  };
}
