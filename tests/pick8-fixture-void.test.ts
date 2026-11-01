import test from "node:test";
import assert from "node:assert/strict";
import { decideFixtureVoid, effectiveFixtureStatus, londonDay, withEffectiveFixtureStatus } from "../utils/pick8-fixture-void.ts";
import {
  effectiveEntryDeadline,
  getFixtureLifecycle,
  getMatchdayGoalProgress,
  isFixtureSelectionEditable,
  protectedEntryDeadline,
} from "../utils/pick8-fixture-state.ts";
import { harness } from "./helpers/pick8-sync-harness.ts";
import type * as ScoringModule from "../utils/pick8-scoring";

// pick8-scoring.ts is server-only; load it the way the sync tests do.
const scoring = harness().load<typeof ScoringModule>("utils/pick8-scoring.ts");
const { calculateCompletedMatchdayGoalTotal, isMatchdayReadyForFinalScoring, scoreEntry, scoreFixtureSelection } = scoring;
type ScoringFixture = ScoringModule.ScoringFixture;

// The SQL trigger is proven against Postgres in tests/pick8-permanent-void-postgres.mjs, which also compares it
// with decideFixtureVoid over a grid. These cases pin the policy in readable form.
const K0 = "2026-12-12T15:00:00.000Z";
const at = (iso: string) => ({ status: "timed", kickoff_at: iso });
const decide = (previous: { status: string; kickoff_at: string } | null, next: { status: string; kickoff_at: string }, locked = true) =>
  decideFixtureVoid({ previous, next, entryDeadlineElapsed: locked });

test("a postponed match that has not started is void whether or not the entry deadline has passed", () => {
  assert.equal(decide(at(K0), { status: "postponed", kickoff_at: K0 }, true), "postponed");
  assert.equal(decide(at(K0), { status: "postponed", kickoff_at: K0 }, false), "postponed");
  assert.equal(decide(null, { status: "postponed", kickoff_at: K0 }), "postponed");
  for (const started of ["in_play", "paused", "finished"]) {
    assert.equal(decide({ status: started, kickoff_at: K0 }, { status: "postponed", kickoff_at: K0 }), null, started);
  }
});

test("a move to a later calendar day after the deadline is a reschedule; a delay within the day is not", () => {
  assert.equal(decide(at(K0), at("2026-12-12T18:30:00.000Z")), null, "three and a half hours later, same day");
  assert.equal(decide(at(K0), at("2026-12-13T12:30:00.000Z")), "rescheduled");
  assert.equal(decide(at(K0), at("2026-12-12T12:00:00.000Z")), null, "earlier is never a postponement");
  assert.equal(decide(at(K0), at("2026-12-13T12:30:00.000Z"), false), null, "before the deadline entries can still be revised");
  assert.equal(decide(at(K0), at(K0)), null);
});

test("calendar days are London days, in summer time too", () => {
  assert.equal(londonDay("2026-07-01T23:30:00Z"), "2026-07-02");
  assert.equal(londonDay("2026-12-01T23:30:00Z"), "2026-12-01");
  assert.equal(decide(at("2026-07-01T22:30:00Z"), at("2026-07-02T00:00:00Z")), "rescheduled");
  assert.equal(decide(at("2026-07-01T15:00:00Z"), at("2026-07-01T22:30:00Z")), null);
  assert.equal(londonDay("not a date"), null);
});

test("a started or finished match is never voided by a kickoff change", () => {
  for (const status of ["in_play", "paused", "finished"]) {
    assert.equal(decide({ status, kickoff_at: K0 }, { status, kickoff_at: "2026-12-14T15:00:00.000Z" }), null, status);
  }
});

test("interrupted matches: held, then void only when the provider moves them to a later day", () => {
  assert.equal(decide(at(K0), { status: "suspended", kickoff_at: K0 }), null);
  assert.equal(decide(at(K0), { status: "abandoned", kickoff_at: K0 }), null);
  assert.equal(decide({ status: "suspended", kickoff_at: K0 }, { status: "in_play", kickoff_at: K0 }), null, "resumes");
  assert.equal(decide({ status: "suspended", kickoff_at: K0 }, { status: "finished", kickoff_at: K0 }), null);
  assert.equal(decide({ status: "suspended", kickoff_at: K0 }, at("2026-12-12T20:00:00.000Z")), null, "resumed later the same day");
  assert.equal(decide({ status: "suspended", kickoff_at: K0 }, at("2026-12-16T19:45:00.000Z")), "rescheduled");
  assert.equal(decide({ status: "abandoned", kickoff_at: K0 }, at("2026-12-16T19:45:00.000Z")), "abandoned");
  assert.equal(decide({ status: "abandoned", kickoff_at: K0 }, { status: "finished", kickoff_at: K0 }), null, "result stands");
});

test("a cancelled fixture is not decided (the provider may still correct it)", () => {
  assert.equal(decide(at(K0), { status: "cancelled", kickoff_at: K0 }), null);
});

test("the effective status of a voided fixture is postponed, whatever the provider mirror says", () => {
  assert.equal(effectiveFixtureStatus({ status: "finished", voided_at: "2026-12-12T16:00:00Z" }), "postponed");
  assert.equal(effectiveFixtureStatus({ status: "finished", voided_at: null }), "finished");
  assert.equal(effectiveFixtureStatus({ status: "timed" }), "timed");
  assert.deepEqual(withEffectiveFixtureStatus([{ id: "a", status: "timed", voided_at: "x" }, { id: "b", status: "timed", voided_at: null }]),
    [{ id: "a", status: "postponed" }, { id: "b", status: "timed" }]);
});

test("a voided fixture is void in every lifecycle view, with its new date or a replayed score", () => {
  const voided = { kickoff_at: "2027-01-20T15:00:00.000Z", status: "timed", voided_at: "2026-12-12T16:00:00Z" };
  const now = Date.parse("2026-12-13T12:00:00Z");
  assert.equal(getFixtureLifecycle(voided, now), "void");
  assert.equal(getFixtureLifecycle({ ...voided, status: "finished" }, now), "void");
  assert.equal(isFixtureSelectionEditable(voided, now), false);
  const progress = getMatchdayGoalProgress([
    { kickoff_at: "2026-12-12T12:00:00.000Z", status: "finished", home_score: 2, away_score: 1 },
    { ...voided, status: "finished", home_score: 5, away_score: 5 },
  ], Date.parse("2027-01-21T00:00:00Z"));
  assert.deepEqual(progress, { hasStarted: true, currentGoals: 3 });
});

const fixture = (id: string, status: string, home: number | null, away: number | null, voided_at: string | null = null): ScoringFixture =>
  ({ id, kickoff_at: "2026-12-12T12:00:00.000Z", status, home_score: home, away_score: away, voided_at });

test("scoring rules: a voided fixture is terminal, scores nothing and adds no goals even with a replayed score", () => {
  const fixtures = [fixture("a", "finished", 2, 1), fixture("b", "timed", null, null, "2026-12-12T16:00:00Z"), fixture("c", "finished", 1, 0)];
  assert.equal(isMatchdayReadyForFinalScoring(fixtures), true);
  assert.equal(calculateCompletedMatchdayGoalTotal(fixtures), 4);
  const replayed = fixtures.map((f) => f.id === "b" ? { ...f, status: "finished", home_score: 7, away_score: 7 } : f);
  assert.equal(isMatchdayReadyForFinalScoring(replayed), true);
  assert.equal(calculateCompletedMatchdayGoalTotal(replayed), 4);
  const voidPick = scoreFixtureSelection({ category: "home_win", selected_team_side: "home" }, replayed[1]);
  assert.deepEqual([voidPick.pointsAwarded, voidPick.isCorrect], [null, null]);
  // Without the void it would hold the matchday, and the same fixture finished and unvoided is scored.
  assert.equal(isMatchdayReadyForFinalScoring([fixture("a", "finished", 2, 1), fixture("b", "timed", null, null)]), false);
  assert.equal(scoreFixtureSelection({ category: "home_win", selected_team_side: "home" }, fixture("b", "finished", 3, 0)).pointsAwarded, 8);
  const entry = scoreEntry({
    selections: [{ id: "s1", category: "home_win", fixture_id: "a", selected_team_side: "home" }, { id: "s2", category: "away_win", fixture_id: "b", selected_team_side: "away" }],
    fixturesById: new Map(replayed.map((f) => [f.id, f])), totalGoalsPrediction: 4, finalScoringReady: true, completedGoalTotal: 4,
  });
  assert.equal(entry.calculatedScore, 6 + 10);
});

test("suspended and abandoned fixtures are not terminal, so they hold the matchday", () => {
  for (const status of ["suspended", "abandoned"]) {
    assert.equal(isMatchdayReadyForFinalScoring([fixture("a", "finished", 2, 1), fixture("b", status, 1, 0)]), false, status);
  }
});

test("the entry deadline can only move earlier once it has passed", () => {
  const stored = "2026-12-12T12:30:00.000Z";
  const after = Date.parse("2026-12-12T13:00:00Z");
  assert.equal(protectedEntryDeadline(stored, "2026-12-20T15:00:00.000Z", after), stored, "a late reschedule of the earliest fixture");
  assert.equal(protectedEntryDeadline(stored, "2026-12-12T11:00:00.000Z", after), "2026-12-12T11:00:00.000Z", "an earlier fixture still tightens it");
  assert.equal(protectedEntryDeadline(stored, "2026-12-20T15:00:00.000Z", Date.parse("2026-12-12T10:00:00Z")), "2026-12-20T15:00:00.000Z", "before the deadline nothing is protected");
  assert.equal(protectedEntryDeadline(null, "2026-12-20T15:00:00.000Z", after), "2026-12-20T15:00:00.000Z");
  assert.equal(effectiveEntryDeadline(stored, [{ kickoff_at: "2026-12-20T15:00:00.000Z" }, { kickoff_at: "2026-12-21T15:00:00.000Z" }], after), stored);
  assert.equal(effectiveEntryDeadline(stored, [], after), stored);
});
