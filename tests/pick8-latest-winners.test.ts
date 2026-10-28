import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  buildLatestMatchdayWinners,
  isMatchdaySettled,
  resolveLatestSettledMatchday,
  selectPodiumRows,
  type SettlementMatchday,
} from "../utils/pick8-latest-winners.ts";
import type { StandingsEntry, StandingsProfile } from "../utils/pick8-standings.ts";
import type { BreakdownFixture, BreakdownPlayer, BreakdownSelection } from "../utils/pick8-breakdown-types.ts";
import type * as BreakdownModule from "../utils/pick8-matchday-breakdown";

const root = join(import.meta.dirname, "..");

function matchday(number: number, overrides: Partial<SettlementMatchday> = {}): SettlementMatchday {
  return {
    id: `m${number}`, matchday_number: number, status: "completed", locks_at: "2026-09-01T00:00:00.000Z", pick8_rules_version: 1,
    scoring_revision: 1, scored_revision: 1, scoring_pending: false, is_accelerated_test: false, ...overrides,
  };
}
function entry(matchdayNumber: number, userId: string, score: number | null, submitted = true): StandingsEntry {
  return { id: `e${matchdayNumber}-${userId}`, user_id: userId, matchday_id: `m${matchdayNumber}`, submitted_at: submitted ? "2026-08-30T00:00:00.000Z" : null, calculated_score: score };
}
const profiles: StandingsProfile[] = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ id, display_name: id.toUpperCase() }));

test("the latest settled matchday is chosen, not the latest scheduled or in-progress one", () => {
  const matchdays = [matchday(1), matchday(2), matchday(3, { status: "scoring" }), matchday(4, { status: "open" }), matchday(5, { status: "upcoming" })];
  const entries = [entry(1, "a", 40), entry(2, "a", 30), entry(3, "a", null), entry(4, "a", null)];
  assert.equal(resolveLatestSettledMatchday(matchdays, entries)?.matchday_number, 2);
});

test("a season with no completed matchday has no winners", () => {
  const matchdays = [matchday(1, { status: "open" }), matchday(2, { status: "upcoming" })];
  assert.equal(resolveLatestSettledMatchday(matchdays, []), null);
  assert.equal(resolveLatestSettledMatchday([], []), null);
});

test("incomplete settlement falls back to the previous settled matchday instead of showing partial results", () => {
  const entries = [entry(1, "a", 20), entry(2, "a", 30), entry(2, "b", null)]; // b's entry is not scored yet
  assert.equal(resolveLatestSettledMatchday([matchday(1), matchday(2)], entries)?.matchday_number, 1);
  assert.equal(isMatchdaySettled(matchday(2), entries), false);
});

test("queued or stale scoring, accelerated tests and empty matchdays are not settled", () => {
  const entries = [entry(2, "a", 30)];
  assert.equal(isMatchdaySettled(matchday(2), entries), true);
  assert.equal(isMatchdaySettled(matchday(2, { scoring_pending: true }), entries), false);
  assert.equal(isMatchdaySettled(matchday(2, { scoring_revision: 3, scored_revision: 2 }), entries), false);
  assert.equal(isMatchdaySettled(matchday(2, { scoring_revision: 3, scored_revision: 3 }), entries), true);
  assert.equal(isMatchdaySettled(matchday(2, { scoring_revision: 0, scored_revision: null }), entries), true, "matchdays scored before revision tracking still qualify");
  assert.equal(isMatchdaySettled(matchday(2, { is_accelerated_test: true }), entries), false);
  assert.equal(isMatchdaySettled(matchday(2), []), false, "no submitted entries means nothing to rank");
});

test("unsubmitted drafts do not block settlement and never reach the podium", () => {
  const entries = [entry(1, "a", 25), entry(1, "b", null, false)];
  assert.equal(isMatchdaySettled(matchday(1), entries), true);
  const { rows } = selectPodiumRows(profiles, entries, matchday(1));
  assert.deepEqual(rows.map((row) => row.profile.id), ["a"]);
});

test("ties share a rank and rank 3 uses standard competition ranking", () => {
  const entries = [entry(1, "a", 50), entry(1, "b", 50), entry(1, "c", 40), entry(1, "d", 30), entry(1, "e", 30), entry(1, "f", 10)];
  const { rows, hiddenTied } = selectPodiumRows(profiles, entries, matchday(1));
  assert.deepEqual(rows.map((row) => [row.profile.id, row.rank]), [["a", 1], ["b", 1], ["c", 3]]);
  assert.equal(hiddenTied, 0);

  const tiedThird = [entry(1, "a", 50), entry(1, "b", 40), entry(1, "c", 30), entry(1, "d", 30), entry(1, "e", 30), entry(1, "f", 5)];
  const result = selectPodiumRows(profiles, tiedThird, matchday(1));
  assert.deepEqual(result.rows.map((row) => [row.profile.id, row.rank]), [["a", 1], ["b", 2], ["c", 3], ["d", 3], ["e", 3]]);
});

test("a five-way tie at the top is bounded and reports how many were left out", () => {
  const entries = ["a", "b", "c", "d", "e", "f", "g"].map((id) => entry(1, id, 44));
  const { rows, hiddenTied } = selectPodiumRows(profiles, entries, matchday(1), 5);
  assert.equal(rows.length, 5);
  assert.ok(rows.every((row) => row.rank === 1));
  assert.equal(hiddenTied, 2);
});

test("only the settled matchday's scores count, and players without an entry are absent", () => {
  const entries = [entry(1, "a", 90), entry(2, "b", 10), entry(2, "c", 5)];
  const { rows } = selectPodiumRows(profiles, entries, matchday(2));
  assert.deepEqual(rows.map((row) => [row.profile.id, row.points, row.rank]), [["b", 10, 1], ["c", 5, 2]]);
  assert.deepEqual(selectPodiumRows(profiles, [], matchday(2)).rows, []);
});

test("negative and zero scores rank correctly", () => {
  const entries = [entry(1, "a", -20), entry(1, "b", 0), entry(1, "c", -20)];
  const { rows } = selectPodiumRows(profiles, entries, matchday(1));
  assert.deepEqual(rows.map((row) => [row.profile.id, row.points, row.rank]), [["b", 0, 1], ["a", -20, 2], ["c", -20, 2]]);
});

const fixtures: BreakdownFixture[] = [
  { id: "f1", home_team_name: "Arsenal", away_team_name: "Chelsea", home_team_crest_url: null, away_team_crest_url: null, kickoff_at: "2026-09-01T10:00:00.000Z", status: "finished", home_score: 2, away_score: 1 },
  { id: "f2", home_team_name: "Everton", away_team_name: "Fulham", home_team_crest_url: null, away_team_crest_url: null, kickoff_at: "2026-09-01T12:00:00.000Z", status: "postponed", home_score: null, away_score: null },
  { id: "f3", home_team_name: "Leeds", away_team_name: "Burnley", home_team_crest_url: null, away_team_crest_url: null, kickoff_at: "2026-09-01T14:00:00.000Z", status: "finished", home_score: 0, away_score: 0 },
];
function selection(id: string, category: string, fixtureId: string, side: string | null, points: number | null, correct: boolean | null): BreakdownSelection {
  return { id, entry_id: "e1-a", category, fixture_id: fixtureId, selected_team_side: side, points_awarded: points, is_correct: correct };
}

test("presentation: picks in rule order with fixture, score, points and Total Goals", () => {
  const { rows } = selectPodiumRows(profiles, [entry(1, "a", 25)], matchday(1));
  const players: BreakdownPlayer[] = [{
    player: { id: "a", display_name: "A" },
    entry: { ...entry(1, "a", 25), total_goals_prediction: 3, score_calculated_at: null },
    selections: [
      selection("s3", "team_win", "f2", "home", null, null),
      selection("s2", "draw", "f3", null, 15, true),
      selection("s1", "home_win", "f1", "home", 7, true),
      selection("s4", "clean_sheet", "f1", "away", -10, false),
    ],
    totalGoalsPoints: 10,
  }];
  const view = buildLatestMatchdayWinners({ matchday: matchday(1), rows, hiddenTied: 0, players, fixtures, actualGoals: 3, expectedPickCount: 4 });
  const [winner] = view.winners;
  assert.equal(view.matchdayNumber, 1);
  assert.equal(view.actualGoals, 3);
  assert.equal(winner.name, "A");
  assert.equal(winner.points, 25);
  assert.equal(winner.totalGoalsPrediction, 3);
  assert.equal(winner.totalGoalsPoints, 10);
  assert.deepEqual(winner.picks.map((pick) => pick.id), ["s1", "s2", "s3", "s4"], "ordered by category, not selection order");
  assert.deepEqual(winner.picks[0], { id: "s1", label: "Home Winner — Arsenal", fixture: "Arsenal v Chelsea", result: "2–1", points: 7, state: "correct" });
  assert.deepEqual(winner.picks[1], { id: "s2", label: "Draw", fixture: "Leeds v Burnley", result: "0–0", points: 15, state: "correct" });
  assert.deepEqual(winner.picks[2], { id: "s3", label: "Everton to Win — Team to Win", fixture: "Everton v Fulham", result: "Void", points: 0, state: "void" });
  assert.deepEqual(winner.picks[3], { id: "s4", label: "Chelsea Clean Sheet", fixture: "Arsenal v Chelsea", result: "2–1", points: -10, state: "incorrect" });
});

const V1 = ["home_win", "away_win", "draw", "team_win", "team_lose", "team_score", "clean_sheet"];
const V2 = [...V1, "btts"];
function fullPlayer(categories: string[], tgPoints: number): BreakdownPlayer {
  return {
    player: { id: "a", display_name: "A" },
    entry: { ...entry(1, "a", 25), total_goals_prediction: 4, score_calculated_at: null },
    selections: categories.map((category, index) => selection(`s${index}`, category, "f1", ["draw", "btts"].includes(category) ? null : "home", 5, true)),
    totalGoalsPoints: tgPoints,
  };
}

test("rules v1 shows all seven picks and v2 all eight, each with Total Goals", () => {
  const { rows } = selectPodiumRows(profiles, [entry(1, "a", 25)], matchday(1));
  const v1 = buildLatestMatchdayWinners({ matchday: matchday(1), rows, hiddenTied: 0, players: [fullPlayer(V1, 10)], fixtures, actualGoals: 3, expectedPickCount: 7 }).winners[0];
  assert.equal(v1.picks.length, 7);
  assert.equal(v1.complete, true);
  assert.equal(v1.totalGoalsPoints, 10);
  const v2 = buildLatestMatchdayWinners({ matchday: matchday(1, { pick8_rules_version: 2 }), rows, hiddenTied: 0, players: [fullPlayer(V2, 0)], fixtures, actualGoals: 3, expectedPickCount: 8 }).winners[0];
  assert.equal(v2.picks.length, 8);
  assert.ok(v2.picks.some((pick) => pick.label === "Both Teams To Score"));
  assert.equal(v2.complete, true);
  assert.equal(v2.totalGoalsPoints, 0, "a genuine zero Total Goals result is shown, not treated as missing");
});

test("fewer picks than the rules require marks the winner incomplete and withholds Total Goals points", () => {
  const { rows } = selectPodiumRows(profiles, [entry(1, "a", 25)], matchday(1));
  const winner = buildLatestMatchdayWinners({ matchday: matchday(1), rows, hiddenTied: 0, players: [fullPlayer(V1.slice(0, 5), 10)], fixtures, actualGoals: 3, expectedPickCount: 7 }).winners[0];
  assert.equal(winner.picks.length, 5);
  assert.equal(winner.complete, false);
  assert.equal(winner.totalGoalsPoints, null);
  assert.equal(winner.expectedPickCount, 7);
});

test("a winner whose breakdown is missing still renders without picks", () => {
  const { rows } = selectPodiumRows(profiles, [entry(1, "a", 25)], matchday(1));
  const view = buildLatestMatchdayWinners({ matchday: matchday(1), rows, hiddenTied: 0, players: [], fixtures, actualGoals: null, expectedPickCount: 7 });
  assert.deepEqual(view.winners[0].picks, []);
  assert.equal(view.winners[0].totalGoalsPoints, null);
  assert.equal(view.winners[0].totalGoalsPrediction, null);
  assert.equal(view.winners[0].complete, false);
});

// The real breakdown builder (server-only) is transpiled in memory so visibility is tested end to end.
function loadBreakdown(): typeof BreakdownModule {
  const nativeRequire = createRequire(import.meta.url);
  const modules = new Map<string, unknown>();
  function load(path: string): unknown {
    if (modules.has(path)) return modules.get(path);
    const exports = {};
    const loaded = { exports };
    modules.set(path, exports);
    const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const stubs: Record<string, unknown> = {
      "server-only": {}, "@/utils/supabase/cron-read": {}, "@/utils/supabase/admin": {}, "@/utils/pick8-sync-diagnostics": {},
    };
    const requireFn = (id: string): unknown => {
      if (id in stubs) return stubs[id];
      if (id.startsWith("@/")) return load(join(root, `${id.slice(2)}.ts`));
      if (id.startsWith(".")) return load(resolve(dirname(path), id.endsWith(".ts") ? id : `${id}.ts`));
      return nativeRequire(id);
    };
    runInNewContext(source, { exports, module: loaded, require: requireFn, Map, Set, Date, console }, { filename: path });
    return loaded.exports;
  }
  return load(join(root, "utils/pick8-matchday-breakdown.ts")) as typeof BreakdownModule;
}

test("picks for a fixture that has not kicked off stay hidden from other viewers, even on the podium", () => {
  const { buildMatchdayBreakdown } = loadBreakdown();
  const now = Date.parse("2026-09-01T13:00:00.000Z"); // f1, f2 kicked off; f3 (14:00) has not
  const md = matchday(1);
  const owner = { ...entry(1, "a", 25), total_goals_prediction: 3, score_calculated_at: null };
  const selections = [selection("s1", "home_win", "f1", "home", 7, true), selection("s2", "draw", "f3", null, 15, true)];
  const inconsistent = fixtures.map((fixture) => fixture.id === "f3" ? { ...fixture, status: "scheduled", home_score: null, away_score: null } : fixture);
  const breakdown = buildMatchdayBreakdown({ matchday: md, profiles: [{ id: "a", display_name: "A" }], entries: [owner], selections, fixtures: inconsistent, viewerId: "viewer", now });
  const { rows } = selectPodiumRows(profiles, [owner], md);
  const view = buildLatestMatchdayWinners({ matchday: md, rows, hiddenTied: 0, players: breakdown.players, fixtures: inconsistent, actualGoals: breakdown.actualGoals, expectedPickCount: 2 });
  assert.deepEqual(view.winners[0].picks.map((pick) => pick.id), ["s1"]);
  assert.equal(view.winners[0].complete, false);
  assert.equal(view.winners[0].totalGoalsPoints, null, "Total Goals points derived from partial picks must not be shown");
  assert.equal(view.actualGoals, null, "actual goals are withheld until every fixture is final");

  const ownerView = buildMatchdayBreakdown({ matchday: md, profiles: [{ id: "a", display_name: "A" }], entries: [owner], selections, fixtures: inconsistent, viewerId: "a", now });
  assert.equal(buildLatestMatchdayWinners({ matchday: md, rows, hiddenTied: 0, players: ownerView.players, fixtures: inconsistent, actualGoals: ownerView.actualGoals, expectedPickCount: 2 }).winners[0].picks.length, 2);
});

test("drafts of other players are never picked up by the winners breakdown", () => {
  const { buildMatchdayBreakdown } = loadBreakdown();
  const draft = { ...entry(1, "a", null, false), total_goals_prediction: 2, score_calculated_at: null };
  const breakdown = buildMatchdayBreakdown({
    matchday: matchday(1), profiles: [{ id: "a", display_name: "A" }], entries: [draft],
    selections: [selection("s1", "home_win", "f1", "home", null, null)], fixtures, viewerId: "viewer", now: Date.parse("2026-12-01T00:00:00.000Z"),
  });
  assert.equal(breakdown.players[0].entry, null);
  assert.equal(breakdown.players[0].selections.length, 0);
});

test("the dashboard adds the podium to its existing queries rather than issuing new ones", () => {
  const page = readFileSync(join(root, "app/(app)/dashboard/page.tsx"), "utf8");
  assert.equal(page.match(/\.from\("entry_selections"\)/g)?.length, 1);
  assert.equal(page.match(/\.from\("fixtures"\)/g)?.length, 1);
  assert.equal(page.match(/\.from\("entries"\)/g)?.length, 1);
  assert.match(page, /buildMatchdayBreakdown\(\{\s*matchday: settledMatchday/, "podium picks must go through the visibility-aware breakdown");
  assert.match(page, /resolveDashboardMatchday\(matchdays, now\)/, "the primary matchday selection is unchanged");
});
