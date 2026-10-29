import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { harness } from "./helpers/pick8-sync-harness.ts";
import type * as FixtureStateModule from "../utils/pick8-fixture-state";
import type * as ScoringModule from "../utils/pick8-scoring";

// Consumer side of the Who You Got -> Pick8 contract. The JSON is byte-identical to Who You Got's copy, whose own test
// proves its route emits exactly these responses; Who You Got CI runs this file against its copy
// (WYG_SHARED_FIXTURES_CONTRACT) and fails if the two differ. Every response goes through the real sync code.
// Changing the contract: update the JSON and this consumer here first, merge, then change Who You Got.
type Row = Record<string, unknown>;
type ApiFixture = {
  externalFixtureId: string; homeTeamId: number | null; awayTeamId: number | null;
  homeTeamName: string; awayTeamName: string; homeTeamCrestUrl: string | null; awayTeamCrestUrl: string | null;
  kickoffAt: string; status: string; homeScore: number | null; awayScore: number | null; updatedAt: string | null;
};
type ApiResponse = { season: number; providerSeason: string; matchday: number; fixtures: ApiFixture[] };
type Op = { op: "set" | "remove" | "reverse"; path: Array<string | number>; value?: unknown };
type Contract = {
  contract: string; version: number; request: { season: number; matchday: number };
  responseHeaders: { success: Record<string, string | null> };
  statuses: Record<string, { providerStatuses: string[]; pick8Lifecycle: "pending" | "live" | "finished" | "void"; terminal: boolean }>;
  errors: Record<string, { pick8Error: string }>;
  scenarios: Array<{ name: string; asOf: string; response: ApiResponse }>;
  mutationBase: string;
  consumerMustReject: Array<{ name: string; ops: Op[] }>;
  consumerMustTolerate: Array<{ name: string; ops: Op[] }>;
};

const contractPath = process.env.WYG_SHARED_FIXTURES_CONTRACT ?? "tests/fixtures/shared-football-fixtures-contract.json";
const contract = JSON.parse(readFileSync(contractPath, "utf8")) as Contract;
const { season, matchday } = contract.request;
const scenario = (name: string) => contract.scenarios.find((s) => s.name === name)!;
const [inProgress, settled, rescheduled] = ["matchday-in-progress", "matchday-settled-with-corrections", "postponed-fixture-rescheduled"].map(scenario);
const base = scenario(contract.mutationBase);

// An entry submitted before the first kickoff, picking two fixtures whose results the contract later corrects.
function contractHarness(asOf: string) {
  const h = harness({ providerSeason: season, matchdayNumber: matchday, now: asOf, seed: (tables) => {
    Object.assign(tables.seasons[0], { provider_season: season, name: `${season}/${String((season + 1) % 100).padStart(2, "0")}` });
    Object.assign(tables.matchdays[0], { matchday_number: matchday, status: "open", locks_at: "2025-10-03T19:00:00.000Z" });
    const seeded = (f: ApiFixture) => ({ id: `pick8-${f.externalFixtureId}`, matchday_id: "matchday", ...pick8Row({ ...f, status: "timed", homeScore: null, awayScore: null }) });
    tables.fixtures = ["537845", "537854"].map((id) => seeded(base.response.fixtures.find((f) => f.externalFixtureId === id)!));
    tables.entries = [{ id: "entry", matchday_id: "matchday", submitted_at: "2025-10-02T12:00:00Z", total_goals_prediction: 18 }];
    tables.entry_selections = [
      { id: "btts", entry_id: "entry", category: "btts", fixture_id: "pick8-537845", selected_team_side: null },
      { id: "home-win", entry_id: "entry", category: "home_win", fixture_id: "pick8-537854", selected_team_side: "home" },
    ];
  } });
  return {
    ...h,
    apply: async (response: unknown, asOfTime?: string) => {
      if (asOfTime) h.clock(asOfTime);
      h.setUpstream(structuredClone(response));
      return h.sync();
    },
    rowFor: (externalFixtureId: string) => h.tables.fixtures.find((f) => f.external_fixture_id === externalFixtureId)!,
    selection: (id: string) => h.tables.entry_selections.find((s) => s.id === id)!,
  };
}

function pick8Row(f: ApiFixture) {
  return {
    external_fixture_id: f.externalFixtureId, home_team_id: f.homeTeamId, away_team_id: f.awayTeamId,
    home_team_name: f.homeTeamName, away_team_name: f.awayTeamName,
    home_team_crest_url: f.homeTeamCrestUrl, away_team_crest_url: f.awayTeamCrestUrl,
    kickoff_at: new Date(f.kickoffAt).toISOString(), status: f.status, home_score: f.homeScore, away_score: f.awayScore,
  };
}

function assertApplied(h: ReturnType<typeof contractHarness>, response: ApiResponse) {
  assert.equal(h.tables.fixtures.length, response.fixtures.length);
  for (const fixture of response.fixtures) {
    const row = h.rowFor(fixture.externalFixtureId);
    assert.ok(row, fixture.externalFixtureId);
    assert.deepEqual(Object.fromEntries(Object.keys(pick8Row(fixture)).map((k) => [k, row[k]])), pick8Row(fixture));
  }
}

function applyOps(value: unknown, ops: Op[]) {
  const copy = structuredClone(value) as Row;
  for (const { op, path, value: next } of ops) {
    const parent = path.slice(0, -1).reduce<Row>((node, key) => node[key] as Row, copy);
    const key = path.at(-1)!;
    if (op === "set") parent[key] = next;
    else if (op === "remove") delete parent[key];
    else (parent[key] as unknown[]).reverse();
  }
  return copy;
}

const snapshot = (h: ReturnType<typeof contractHarness>) => JSON.parse(JSON.stringify({ fixtures: h.tables.fixtures, matchday: h.tables.matchdays[0], selections: h.tables.entry_selections }));

test("contract identity and version are ones this consumer was written for", () => {
  assert.equal(contract.contract, "who-you-got/shared-football-fixtures");
  assert.equal(contract.version, 1);
  assert.ok(base, "mutationBase must name a scenario");
  assert.ok(inProgress && settled && rescheduled);
});

test("every contract status has the Pick8 lifecycle and terminality the contract states", () => {
  const h = contractHarness(inProgress.asOf);
  const state = h.load<typeof FixtureStateModule>("utils/pick8-fixture-state.ts");
  const scoring = h.load<typeof ScoringModule>("utils/pick8-scoring.ts");
  for (const [status, expected] of Object.entries(contract.statuses)) {
    for (const kickoff_at of ["2025-10-01T00:00:00Z", "2025-12-01T00:00:00Z"]) {
      const lifecycle = state.getFixtureLifecycle({ status, kickoff_at }, Date.parse(inProgress.asOf));
      if (expected.pick8Lifecycle === "pending") assert.ok(["upcoming", "locked"].includes(lifecycle), `${status}: ${lifecycle}`);
      else assert.equal(lifecycle, expected.pick8Lifecycle, status);
    }
    const fixture = { id: "f", status, kickoff_at: inProgress.asOf, home_score: 1, away_score: 0 } as ScoringModule.ScoringFixture;
    assert.equal(scoring.isMatchdayReadyForFinalScoring([fixture]), expected.terminal, status);
  }
});

test("in-progress, corrected and rescheduled responses apply through the real sync with stable identity", async () => {
  const h = contractHarness(inProgress.asOf);

  const first = await h.apply(inProgress.response);
  assertApplied(h, inProgress.response);
  assert.equal(first.providerContentVersion ?? null, contract.responseHeaders.success.etag);
  assert.equal(first.inserted, inProgress.response.fixtures.length - 2);
  assert.equal(first.updated, 2);
  assert.equal(first.removed + first.invalidatedEntries, 0);
  assert.equal(h.tables.matchdays[0].status, "scoring");
  assert.deepEqual([h.selection("btts").points_awarded, h.selection("home-win").points_awarded], [-10, null]);
  const ids = new Map(h.tables.fixtures.map((f) => [f.external_fixture_id, f.id]));
  assert.equal(ids.get("537845"), "pick8-537845");

  // Score correction (0-1 -> 1-1) and SUSPENDED (served as cancelled = void) resuming as finished 2-1.
  const second = await h.apply(settled.response, settled.asOf);
  assertApplied(h, settled.response);
  assert.equal(second.fastPath, false);
  assert.equal(second.inserted + second.removed + second.invalidatedEntries, 0);
  assert.deepEqual(new Map(h.tables.fixtures.map((f) => [f.external_fixture_id, f.id])), ids);
  assert.equal(h.tables.matchdays[0].status, "completed");
  assert.deepEqual([h.selection("btts").points_awarded, h.selection("home-win").points_awarded], [10, 6]);
  assert.equal(h.tables.entries[0].calculated_score, 26);
  assert.equal((await h.apply(settled.response)).fastPath, true);

  // Rescheduled postponed fixture: same id and Pick8 row, new kickoff, pending again. Current Pick8 behaviour is
  // that the matchday leaves "completed" and final entry scores clear until it is played (owner decision pending).
  const third = await h.apply(rescheduled.response, rescheduled.asOf);
  assertApplied(h, rescheduled.response);
  assert.equal(third.inserted + third.removed + third.invalidatedEntries, 0);
  assert.deepEqual(new Map(h.tables.fixtures.map((f) => [f.external_fixture_id, f.id])), ids);
  assert.equal(h.rowFor("537852").kickoff_at, "2025-12-03T19:30:00.000Z");
  assert.notEqual(h.tables.matchdays[0].status, "completed");
  assert.equal(h.tables.entries[0].calculated_score, null);
});

for (const { name, ops } of contract.consumerMustReject) {
  test(`fails the matchday closed without writes: ${name}`, async () => {
    const h = contractHarness(base.asOf);
    await h.apply(base.response);
    const before = snapshot(h);
    await assert.rejects(h.apply(applyOps(base.response, ops)), (error: { code?: string }) => error.code === "invalid_response");
    assert.deepEqual(snapshot(h), before);
  });
}

for (const { name, ops } of contract.consumerMustTolerate) {
  test(`accepts without re-applying unchanged content: ${name}`, async () => {
    const h = contractHarness(base.asOf);
    await h.apply(base.response);
    const before = snapshot(h);
    const result = await h.apply(applyOps(base.response, ops));
    assert.equal(result.fastPath, true);
    assert.deepEqual(snapshot(h).fixtures, before.fixtures);
  });
}

test("HTTP error statuses map to the Pick8 error codes the contract states", async () => {
  for (const [status, { pick8Error }] of Object.entries(contract.errors)) {
    const h = contractHarness(base.asOf);
    h.respond(() => Response.json({ error: "Upstream message." }, { status: Number(status), headers: { "Cache-Control": "private, no-store" } }));
    await assert.rejects(h.sync(), (error: { code?: string }) => error.code === pick8Error, status);
    assert.equal(h.tables.fixtures.length, 2);
  }
});
