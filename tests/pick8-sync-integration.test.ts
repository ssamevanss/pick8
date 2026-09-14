import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type * as SyncModule from "../utils/who-you-got-fixture-sync";
import type * as CronModule from "../utils/pick8-cron-automation";

// Exercise the real server orchestration with a deterministic REST-shaped store.
// Production imports are transpiled in memory; no application files are emitted.
type Row = Record<string, unknown>;
type Call = { table: string; operation: string; values?: Row };
function harness() {
  let now = Date.parse("2026-09-13T12:00:00Z");
  class ClockDate extends Date {
    constructor(value?: string | number) { super(value ?? now); }
    static now() { return now; }
  }
  const tables: Record<string, Row[]> = {
    seasons: [{ id: "season", name: "2026/27", provider_season: 2026, is_active: true, competition_refresh_pending: false, competition_revision: 0, competition_refresh_after: null }],
    matchdays: [{ id: "matchday", season_id: "season", matchday_number: 5, fixture_sync_mode: "provider", status: "completed", locks_at: "2026-09-13T10:00:00.000Z", sync_pending: false, scoring_pending: false, sync_revision: 0, scoring_revision: 0, applied_fixture_fingerprint: null, is_accelerated_test: false }],
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
  let rpcErrorCode: string | undefined;
  let fail: ((call: Call) => boolean) | undefined;
  let ambiguous: ((call: Call) => boolean) | undefined;
  let before: ((call: Call) => void) | undefined;
  let upstream = providerPayload();
  function providerPayload() {
    return { matchday: 5, fixtures: tables.fixtures.map((f) => ({ ...f, homeTeamCrestUrl: f.home_team_crest_url, awayTeamCrestUrl: f.away_team_crest_url })) };
  }
  function dirty(scoring = true) {
    const state = tables.matchdays[0];
    state.sync_revision = Number(state.sync_revision) + 1;
    state.sync_pending = true;
    if (scoring) { state.scoring_revision = Number(state.scoring_revision) + 1; state.scoring_pending = true; }
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
          rows = tables[table].filter((row) => row.season_id === (values as Row).season_id && row.matchday_number === (values as Row).matchday_number);
          if (!rows.length) { const row = { id: "matchday", ...(values as Row) }; tables[table].push(row); rows = [row]; }
        }
        if (operation === "update" || operation === "upsert") {
          for (const row of rows) { const old = { ...row }; Object.assign(row, values); changed(table, old, row); }
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
  function rpc(_name: string, args: Record<string, unknown>) {
    const builder = {
      retry(enabled: boolean) { assert.equal(enabled, false); return builder; },
      abortSignal() { return builder; },
      then(resolve: (value: unknown) => unknown) {
        const call = { table: "rpc", operation: "rpc", values: args };
        calls.push(call); before?.(call);
        if (rpcErrorCode) return Promise.resolve(resolve({ data: null, error: { message: "transaction rolled back", code: rpcErrorCode }, status: 400 }));
        if (fail?.(call)) return Promise.resolve(resolve({ data: null, error: { message: "injected failure" } }));
        const md = tables.matchdays[0];
        if (md.scoring_revision !== args.check_scoring_revision) return Promise.resolve(resolve({ data: null, error: { message: "Scoring inputs changed during calculation" } }));
        const scorer = load<typeof import("../utils/pick8-scoring")>("utils/pick8-scoring.ts");
        const fixtures = tables.fixtures as unknown as import("../utils/pick8-scoring").ScoringFixture[];
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
        const lifecycle = load<typeof import("../utils/pick8-fixture-state")>("utils/pick8-fixture-state.ts")
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
      if (id.startsWith(".")) return load(resolve(dirname(path), `${id}.ts`));
      return nativeRequire(id);
    };
    runInNewContext(source, {
      exports, module: loadedModule, require, Date: ClockDate, Map, Set, URL, AbortSignal, performance, setTimeout, clearTimeout, crypto: globalThis.crypto,
      process: { env: { WHO_YOU_GOT_API_URL: "https://example.test", WHO_YOU_GOT_API_KEY: "test" } },
      console: { info: (value: string) => logs.push(JSON.parse(value)), error: () => {} },
      fetch: async () => { upstreamCalls++; return Response.json(upstream); },
    }, { filename: path });
    return loadedModule.exports as T;
  }
  const sync = load<typeof SyncModule>("utils/who-you-got-fixture-sync.ts");
  const cron = load<typeof CronModule>("utils/pick8-cron-automation.ts");
  return {
    tables, calls, logs, dirty, sync: () => sync.syncWhoYouGotFixtures({ season: 2026, matchday: 5, recalculateScores: true }),
    fixtureOnly: () => sync.syncWhoYouGotFixtures({ season: 2026, matchday: 5 }),
    cron: () => cron.runConditionalResultSync(), reconcile: () => cron.runResultReconciliation(),
    upstreamCalls: () => upstreamCalls,
    rpcError: (code: string) => { rpcErrorCode = code; },
    ambiguous: (handler?: (call: Call) => boolean) => { ambiguous = handler; },
    fail: (handler?: (call: Call) => boolean) => { fail = handler; },
    before: (handler?: (call: Call) => void) => { before = handler; },
    limitBudget: (remaining: number) => {
      const context = load<typeof import("../utils/supabase/cron-read")>("utils/supabase/cron-read.ts").currentCronReadContext();
      if (context) context.remaining = () => remaining;
    },
    upstream: () => upstream,
    resetUpstream: () => { upstream = providerPayload(); },
    clock: (value: string) => { now = Date.parse(value); },
  };
}

test("10 fixtures / 10 entries: second result invocation does no fixture/scoring/competition work", async () => {
  const h = harness();
  await h.cron();
  h.calls.length = 0;
  const result = await h.cron();
  assert.equal(result.successes[0].sync.fastPath, true);
  assert.equal(result.successes[0].recalculated, false);
  assert.equal(result.competitionRefresh, null);
  assert.equal(h.upstreamCalls(), 2);
  // Discovery still reads fixtures once; the sync helper does not reread them.
  assert.equal(h.calls.filter((c) => c.table === "fixtures").length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.filter((c) => c.operation !== "select"))), [
    { table: "matchdays", operation: "update", values: { last_upstream_check_at: "2026-09-13T12:00:00.000Z" } },
  ]);
  assert.equal(h.calls.length, 6);
  assert.equal(h.tables.fixtures[0].last_synced_at, "old-check");
  for (const stage of ["discovery", "who_you_got", "fixture_application", "scoring", "competition_refresh", "total"]) {
    assert.ok(h.logs.some((log) => log.stage === stage));
  }
});

test("failed scoring never advances the applied fingerprint and unchanged content retries", async () => {
  const h = harness();
  h.fail((call) => call.table === "rpc");
  await assert.rejects(h.sync(), /injected failure/);
  assert.equal(h.tables.matchdays[0].applied_fixture_fingerprint, null);
  assert.equal(h.tables.matchdays[0].scoring_pending, true);
  h.fail();
  assert.equal((await h.sync()).fastPath, false);
  assert.equal((await h.sync()).fastPath, true);
});

test("a failed changed-fixture write keeps the old applied fingerprint and recovery pending", async () => {
  const h = harness(); await h.sync();
  const old = h.tables.matchdays[0].applied_fixture_fingerprint;
  h.upstream().fixtures[0].home_score = 3;
  h.fail((call) => call.table === "fixtures" && call.operation === "update");
  await assert.rejects(h.sync(), /injected failure/);
  assert.equal(h.tables.matchdays[0].applied_fixture_fingerprint, old);
  assert.equal(h.tables.matchdays[0].sync_pending, true);
  h.fail(); await h.sync();
  assert.notEqual(h.tables.matchdays[0].applied_fixture_fingerprint, old);
});

test("local dirty state and fixture-only calls cannot acknowledge pending scoring", async () => {
  const h = harness(); await h.fixtureOnly();
  assert.equal(h.tables.matchdays[0].applied_fixture_fingerprint, null);
  assert.equal(h.tables.matchdays[0].scoring_pending, true);
  await h.sync(); h.dirty();
  assert.equal((await h.sync()).fastPath, false);
});

test("concurrent input edits cannot be cleared by scoring acknowledgement", async () => {
  const h = harness();
  h.before((call) => {
    if (call.table === "rpc") { h.dirty(); h.before(); }
  });
  await assert.rejects(h.sync(), /inputs changed/);
  assert.equal(h.tables.matchdays[0].scoring_pending, true);
  assert.equal(h.tables.matchdays[0].applied_fixture_fingerprint, null);
});

test("concurrent local edits during the unchanged check cannot be acknowledged", async () => {
  const h = harness(); await h.sync();
  h.before((call) => {
    if (call.table === "matchdays" && call.values?.last_upstream_check_at && !call.values?.sync_pending) { h.dirty(); h.before(); }
  });
  await assert.rejects(h.sync(), /Local state changed/);
  assert.equal(h.tables.matchdays[0].sync_pending, true);
});

test("clock-only kickoff transition prevents a fingerprint fast exit", async () => {
  const h = harness();
  h.tables.matchdays[0].status = "open";
  for (const fixture of h.tables.fixtures) { fixture.status = "timed"; fixture.home_score = null; fixture.away_score = null; }
  h.resetUpstream(); h.clock("2026-09-13T09:00:00Z");
  await h.sync();
  assert.equal(h.tables.matchdays[0].status, "open");
  assert.equal((await h.sync()).fastPath, true);
  h.clock("2026-09-13T10:00:00Z");
  assert.equal((await h.sync()).fastPath, false);
  assert.equal(h.tables.matchdays[0].status, "scoring");
});

test("competition refresh failure retries independently of an unchanged provider matchday", async () => {
  const h = harness(); await h.sync();
  h.tables.seasons[0].competition_refresh_pending = true;
  h.fail((call) => call.table === "competitions");
  await assert.rejects(h.cron(), /injected failure/);
  assert.equal(h.tables.seasons[0].competition_refresh_pending, true);
  h.fail();
  const result = await h.cron();
  assert.equal(result.successes[0].sync.fastPath, true);
  assert.equal(h.tables.seasons[0].competition_refresh_pending, false);
});

test("daily reconciliation also uses the clean fingerprint fast path", async () => {
  const h = harness(); await h.sync(); h.clock("2026-09-14T05:30:00Z");
  const result = await h.reconcile();
  assert.equal(result.successes[0].sync.fastPath, true);
  assert.equal(result.successes[0].recalculated, false);
});

test("a revision change during fingerprint acknowledgement retains dirty state", async () => {
  const h = harness();
  h.before((call) => {
    if (call.values?.applied_fixture_fingerprint) { h.dirty(); h.before(); }
  });
  await assert.rejects(h.sync(), /retry required/);
  assert.equal(h.tables.matchdays[0].applied_fixture_fingerprint, null);
  assert.equal(h.tables.matchdays[0].sync_pending, true);
});

test("fixture membership removal still invalidates affected submissions before acknowledging", async () => {
  const h = harness(); await h.sync();
  h.upstream().fixtures.splice(0, 1);
  const result = await h.sync();
  assert.equal(result.fastPath, false);
  assert.equal(result.removed, 1);
  assert.equal(result.invalidatedEntries, 10);
  assert.equal(h.tables.entries.every((entry) => entry.submitted_at === null), true);
  assert.equal((await h.sync()).fastPath, true);
});

test("invalid provider data cannot refresh a clean fingerprint or check timestamp", async () => {
  const h = harness(); await h.sync();
  const before = { ...h.tables.matchdays[0] };
  h.upstream().fixtures.push(h.upstream().fixtures[0]);
  await assert.rejects(h.sync(), /duplicate fixture IDs/);
  assert.equal(h.tables.matchdays[0].applied_fixture_fingerprint, before.applied_fixture_fingerprint);
  assert.equal(h.tables.matchdays[0].last_upstream_check_at, before.last_upstream_check_at);
});

test("competition clock work runs even when the selected provider matchday is unchanged", async () => {
  const h = harness(); await h.sync();
  h.tables.matchdays.push({ ...h.tables.matchdays[0], id: "next", matchday_number: 6, status: "upcoming", locks_at: "2026-09-13T13:00:00.000Z" });
  h.tables.seasons[0].competition_refresh_pending = true;
  await h.cron();
  assert.equal(h.tables.seasons[0].competition_refresh_after, "2026-09-13T13:00:00.000Z");
  h.clock("2026-09-13T13:00:00Z");
  const result = await h.cron();
  assert.equal(result.successes[0].sync.fastPath, true);
  assert.equal(result.competitionRefresh?.statusesUpdated, 2);
  assert.equal(h.tables.seasons[0].competition_refresh_after, null);
});

const competitionAck = (call: Call) => call.table === "seasons" && call.values?.competition_refresh_pending === false;

test("ambiguous competition acknowledgement reads back committed checkpoint without re-dirtying", async () => {
  const h = harness(); await h.sync(); h.tables.seasons[0].competition_refresh_pending = true;
  h.ambiguous(competitionAck);
  const result = await h.cron();
  assert.equal(result.ok, true);
  assert.equal(h.tables.seasons[0].competition_refresh_pending, false);
  assert.equal(h.calls.filter(competitionAck).length, 1);
  h.calls.length = 0;
  await h.cron();
  assert.equal(h.calls.length, 6);
});

test("ambiguous acknowledgement preserves a newer revision and its pending work", async () => {
  const h = harness(); await h.sync(); h.tables.seasons[0].competition_refresh_pending = true;
  h.ambiguous((call) => {
    if (!competitionAck(call)) return false;
    h.tables.seasons[0].competition_revision = Number(h.tables.seasons[0].competition_revision) + 1;
    h.tables.seasons[0].competition_refresh_pending = true;
    return true;
  });
  await assert.rejects(h.cron(), /Acknowledging competition refresh failed/);
  assert.equal(h.tables.seasons[0].competition_refresh_pending, true);
  assert.equal(h.calls.filter(competitionAck).length, 1);
  h.ambiguous(); await h.cron();
  assert.equal(h.tables.seasons[0].competition_refresh_pending, false);
});

test("failed readback does not overwrite an overlapping worker's completion", async () => {
  const h = harness(); await h.sync(); h.tables.seasons[0].competition_refresh_pending = true;
  h.ambiguous((call) => {
    if (!competitionAck(call)) return false;
    h.tables.seasons[0].competition_revision = Number(h.tables.seasons[0].competition_revision) + 1;
    h.tables.seasons[0].competition_refresh_pending = false;
    h.fail((read) => read.table === "seasons" && read.operation === "select");
    return true;
  });
  await assert.rejects(h.cron(), /Acknowledging competition refresh failed/);
  assert.equal(h.tables.seasons[0].competition_refresh_pending, false);
  assert.equal(h.calls.at(-1)?.operation, "select");
});

test("failed competition load cannot re-dirty another worker's successful refresh", async () => {
  const h = harness(); await h.sync(); h.tables.seasons[0].competition_refresh_pending = true;
  h.fail((call) => {
    if (call.table !== "competitions") return false;
    h.tables.seasons[0].competition_refresh_pending = false;
    return true;
  });
  await assert.rejects(h.cron(), /Loading competitions failed/);
  assert.equal(h.tables.seasons[0].competition_refresh_pending, false);
});

test("committed scoring and fingerprint acknowledgements survive lost responses", async () => {
  const h = harness();
  h.ambiguous((call) => call.table === "rpc" || (call.table === "matchdays" &&
    typeof call.values?.applied_fixture_fingerprint === "string"));
  const result = await h.cron();
  assert.equal(result.ok, true);
  assert.equal(h.tables.matchdays[0].sync_pending, false);
  assert.equal(h.tables.matchdays[0].scoring_pending, false);
  h.calls.length = 0;
  await h.cron();
  assert.equal(h.calls.length, 6);
});

test("older competition refresh cannot overwrite a newer clock checkpoint at the same revision", async () => {
  const h = harness(); await h.sync(); h.tables.seasons[0].competition_refresh_pending = true;
  h.before((call) => {
    if (!competitionAck(call)) return;
    h.tables.seasons[0].competition_refresh_after = "2026-09-15T12:00:00.000Z";
    h.tables.seasons[0].competition_refresh_pending = false;
    h.before();
  });
  await assert.rejects(h.cron(), /Competition inputs changed/);
  assert.equal(h.tables.seasons[0].competition_refresh_after, "2026-09-15T12:00:00.000Z");
  assert.equal(h.tables.seasons[0].competition_refresh_pending, false);
});


test("fingerprint-only recovery reuses committed scoring and returns to fast path while scoring", async () => {
  const h = harness();
  const fixture = h.tables.fixtures[9]; fixture.status = "timed"; fixture.home_score = null; fixture.away_score = null;
  h.tables.matchdays[0].status = "scoring"; h.resetUpstream();
  h.fail(call => typeof call.values?.applied_fixture_fingerprint === "string");
  await assert.rejects(h.sync(), /injected failure/);
  assert.equal(h.tables.matchdays[0].scoring_pending, false);
  assert.equal(h.tables.matchdays[0].sync_pending, true);
  const checkpoint = h.tables.matchdays[0].scoring_result;
  h.fail(); h.calls.length = 0;
  const recovered = await h.sync();
  assert.equal(recovered.scoring?.reused, true);
  assert.equal(h.calls.filter(c=>c.table === "rpc").length, 0);
  assert.equal(h.tables.matchdays[0].scoring_result, checkpoint);
  assert.equal(h.tables.matchdays[0].status, "scoring");
  assert.equal((await h.sync()).fastPath, true);
});

test("insufficient admission budget returns a durable deferred result without RPC or competition work", async () => {
  const h = harness();
  h.before(call => { if (call.table === "matchdays" && call.operation === "upsert") h.limitBudget(1000); });
  const result = await h.cron();
  assert.equal(result.ok, true);
  assert.equal("complete" in result && result.complete, false);
  assert.equal("deferred" in result && result.deferred.length, 1);
  assert.equal(h.tables.matchdays[0].scoring_pending, true);
  assert.equal(h.tables.matchdays[0].sync_pending, true);
  assert.equal(h.calls.filter(c=>c.table === "rpc" || c.table === "competitions").length, 0);
});

test("ambiguous scoring response reads committed result once without repeating RPC", async () => {
  const h = harness(); h.ambiguous(call => call.table === "rpc");
  const result = await h.cron();
  assert.equal(result.ok, true);
  assert.equal(h.calls.filter(c=>c.table === "rpc").length, 1);
  assert.ok(h.logs.some(l => l.readbackOutcome === "committed"));
  assert.equal(h.tables.matchdays[0].scoring_pending, false);
});

test("ambiguous response cannot acknowledge a newer input revision or re-dirty an overlapping completion", async () => {
  const h = harness();
  h.ambiguous(call => {
    if (call.table !== "rpc") return false;
    h.dirty(); return true;
  });
  const result = await h.cron();
  assert.equal("deferred" in result && result.deferred.length, 1);
  assert.equal(h.tables.matchdays[0].scoring_pending, true);
  assert.equal(h.calls.filter(c=>c.table === "rpc").length, 1);
});

test("failed ambiguous read-back returns deferred and preserves committed checkpoint", async () => {
  const h = harness();
  h.ambiguous(call => {
    if (call.table !== "rpc") return false;
    h.fail(read => read.table === "matchdays" && read.operation === "select"); return true;
  });
  const result = await h.cron();
  assert.equal("deferred" in result && result.deferred.length, 1);
  assert.equal(h.tables.matchdays[0].scoring_pending, false);
  assert.equal(h.calls.filter(c=>c.table === "rpc").length, 1);
  h.fail(); h.ambiguous(); h.calls.length = 0;
  await h.sync();
  assert.equal(h.calls.filter(c=>c.table === "rpc").length, 0);
});


test("fingerprint recovery never overwrites a concurrent writer's scoring pending flag", async () => {
  const h = harness();
  h.fail(call => typeof call.values?.applied_fixture_fingerprint === "string");
  await assert.rejects(h.sync()); h.fail(); h.calls.length = 0;
  h.before(call => {
    if (call.table === "matchdays" && call.operation === "upsert") {
      assert.equal(Object.hasOwn(call.values!, "scoring_pending"), false);
      h.dirty(); h.before();
    }
  });
  const result = await h.sync();
  assert.equal(result.scoring?.reused, false);
  assert.equal(h.calls.filter(c=>c.table === "rpc").length, 1);
  assert.equal(h.tables.matchdays[0].scored_revision, h.tables.matchdays[0].scoring_revision);
});

for (const code of ["55P03", "40P01", "40001", "57014"]) {
  test(`RPC ${code} rollback is deferred durably without retrying the mutation`, async () => {
    const h = harness(); h.rpcError(code);
    const result = await h.cron();
    assert.equal("deferred" in result && result.deferred.length, 1);
    assert.equal(h.calls.filter(c=>c.table === "rpc").length, 1);
    assert.equal(h.tables.matchdays[0].scoring_pending, true);
    assert.equal(h.tables.matchdays[0].sync_pending, true);
  });
}
