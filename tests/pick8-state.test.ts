import test from "node:test";
import assert from "node:assert/strict";
import {
  getFixtureLifecycle,
  earliestFixtureKickoff,
  formatPick8Kickoff,
  isInitialPick8EntryWindowOpen,
  isFixtureSelectionEditable,
  isPick8SelectionVisible,
  isSubmittedFixturePickRevealable,
  resolveMatchdayScoringStatus,
} from "../utils/pick8-fixture-state.ts";
import {
  isCompletePick8Entry,
  getPick8EntryState,
  parsePick8DraftSelections,
  PICK8_CATEGORIES,
  restorePick8DraftChoices,
} from "../utils/pick8-entry-validation.ts";
import { logicalPick8FixtureKey } from "../utils/pick8-fixture-identity.ts";
import {
  getFixtureAutomationPlan,
  providerManagedMatchdays,
  shouldSyncProviderFixtures,
} from "../utils/pick8-fixture-sync-mode.ts";
import {
  MATCHDAY_2_FINAL_SCORE_PLAN,
  MATCHDAY_3_FINAL_SCORE_PLAN,
  MATCHDAY_3_TEST_FIXTURE_IDS,
  manualTestFinalGoalTotal,
} from "../utils/pick8-manual-test.ts";
import {
  buildStandings,
  playerMatchdayLifecycle,
  resolveDashboardMatchday,
} from "../utils/pick8-standings.ts";

const kickoffAt = "2026-10-04T10:00:00.000Z";
const kickoff = Date.parse(kickoffAt);

test("a provider-timed fixture locks at the exact configured kickoff", () => {
  const fixture = { kickoff_at: kickoffAt, status: "timed" };
  assert.equal(getFixtureLifecycle(fixture, kickoff - 1), "upcoming");
  assert.equal(isFixtureSelectionEditable(fixture, kickoff - 1), true);
  assert.equal(getFixtureLifecycle(fixture, kickoff), "locked");
  assert.equal(isFixtureSelectionEditable(fixture, kickoff), false);
});

test("kickoff display uses the configured Melbourne timezone across DST", () => {
  assert.match(formatPick8Kickoff(kickoffAt), /9:00\s*pm.*AEDT/i);
});

test("logical fixture identity is stable across provider ID changes and name casing", () => {
  const byIds = logicalPick8FixtureKey({ homeTeamId: 1, awayTeamId: 2, homeTeamName: "Old Home", awayTeamName: "Old Away" });
  assert.equal(byIds, logicalPick8FixtureKey({ homeTeamId: 1, awayTeamId: 2, homeTeamName: "Renamed", awayTeamName: "Renamed Away" }));
  assert.equal(
    logicalPick8FixtureKey({ homeTeamId: null, awayTeamId: null, homeTeamName: " Arsenal FC ", awayTeamName: "CHELSEA FC" }),
    logicalPick8FixtureKey({ homeTeamId: null, awayTeamId: null, homeTeamName: "arsenal fc", awayTeamName: "chelsea fc" }),
  );
});

test("provider live, finished and postponed states remain distinct", () => {
  assert.equal(getFixtureLifecycle({ kickoff_at: kickoffAt, status: "in_play" }, kickoff), "live");
  assert.equal(getFixtureLifecycle({ kickoff_at: kickoffAt, status: "finished" }, kickoff), "finished");
  assert.equal(getFixtureLifecycle({ kickoff_at: kickoffAt, status: "postponed" }, kickoff - 1), "void");
});

test("another player's pick is revealed only for its own started fixture", () => {
  const common = { viewerId: "viewer", ownerId: "other", submittedAt: "2026-10-01T00:00:00Z" };
  assert.equal(isPick8SelectionVisible({ ...common, kickoffAt, now: kickoff - 1 }), false);
  assert.equal(isPick8SelectionVisible({ ...common, kickoffAt, now: kickoff }), true);
  assert.equal(isPick8SelectionVisible({ ...common, kickoffAt: "2026-10-05T10:00:00Z", now: kickoff }), false);
});

test("draft picks remain private after kickoff while owners retain access", () => {
  assert.equal(isPick8SelectionVisible({ viewerId: "viewer", ownerId: "other", submittedAt: null, kickoffAt, now: kickoff }), false);
  assert.equal(isPick8SelectionVisible({ viewerId: "owner", ownerId: "owner", submittedAt: null, kickoffAt, now: kickoff - 1 }), true);
});

test("fixture drawers include only submitted picks for that started fixture", () => {
  const common = { fixtureId: "fixture-one", selectionFixtureId: "fixture-one", kickoffAt, now: kickoff };
  assert.equal(isSubmittedFixturePickRevealable({ ...common, submittedAt: "2026-10-01T00:00:00Z" }), true);
  assert.equal(isSubmittedFixturePickRevealable({ ...common, submittedAt: null }), false);
  assert.equal(isSubmittedFixturePickRevealable({ ...common, submittedAt: "2026-10-01T00:00:00Z", now: kickoff - 1 }), false);
  assert.equal(isSubmittedFixturePickRevealable({ ...common, submittedAt: "2026-10-01T00:00:00Z", selectionFixtureId: "fixture-two" }), false);
});

test("initial deadline closes at the first configured fixture kickoff", () => {
  assert.equal(earliestFixtureKickoff([
    { kickoff_at: "2026-08-10T11:00:00Z" },
    { kickoff_at: "2026-08-10T09:00:00Z" },
    { kickoff_at: "2026-08-10T10:00:00Z" },
  ]), "2026-08-10T09:00:00.000Z");
  assert.equal(earliestFixtureKickoff([]), null);
});

test("an early results refresh cannot move a matchday to scoring before kickoff", () => {
  const fixture = { kickoff_at: kickoffAt, status: "scheduled" };
  assert.equal(resolveMatchdayScoringStatus({ currentStatus: "open", fixtures: [fixture], finalScoringReady: false, now: kickoff - 1 }), "open");
  assert.equal(resolveMatchdayScoringStatus({ currentStatus: "open", fixtures: [fixture], finalScoringReady: false, now: kickoff }), "scoring");
  assert.equal(resolveMatchdayScoringStatus({ currentStatus: "scoring", fixtures: [fixture], finalScoringReady: false, now: kickoff - 1 }), "open");
  assert.equal(isInitialPick8EntryWindowOpen("scoring", kickoffAt, kickoff - 1), true);
  assert.equal(isInitialPick8EntryWindowOpen("scoring", kickoffAt, kickoff), false);
});

test("submission requires seven unique categories, seven fixtures and Total Goals", () => {
  const complete = PICK8_CATEGORIES.map((category, index) => ({ category, fixtureId: `fixture-${index}` }));
  assert.equal(isCompletePick8Entry(complete, 25), true);
  assert.equal(isCompletePick8Entry(complete.slice(0, 6), 25), false);
  assert.equal(isCompletePick8Entry(complete, null), false);
  assert.equal(isCompletePick8Entry(complete.map((pick) => ({ ...pick, fixtureId: "same" })), 25), false);
});

test("entry state is derived only from row existence and submitted_at", () => {
  assert.equal(getPick8EntryState(null), "not_started");
  assert.equal(getPick8EntryState({ submitted_at: null }), "draft");
  assert.equal(getPick8EntryState({ submitted_at: "2026-10-01T00:00:00Z" }), "submitted");
});

test("an incomplete seven-pick draft survives form serialization and reload", () => {
  const fixtureIds = Array.from({ length: 10 }, (_, index) => `fixture-${index + 1}`);
  const formData = new FormData();
  PICK8_CATEGORIES.forEach((category, index) => {
    formData.set(`fixture_category_${fixtureIds[index]}`, category);
    formData.set(`fixture_side_${fixtureIds[index]}`, category === "draw" ? "" : index % 2 ? "away" : "home");
  });

  const parsed = parsePick8DraftSelections(formData, fixtureIds);
  assert.ok("selections" in parsed);
  assert.equal(parsed.selections.length, 7);
  assert.equal(formData.get("total_goals"), null);
  assert.equal(isCompletePick8Entry(parsed.selections, null), false);

  const restored = restorePick8DraftChoices(fixtureIds, parsed.selections);
  assert.equal(Object.values(restored).filter((choice) => choice.category).length, 7);
  PICK8_CATEGORIES.forEach((category, index) => {
    assert.equal(restored[fixtureIds[index]]?.category, category);
  });

  assert.equal(isCompletePick8Entry(parsed.selections, 27), true);
});

test("fixture automation never provider-syncs a manual matchday", () => {
  assert.equal(shouldSyncProviderFixtures("manual"), false);
  assert.equal(getFixtureAutomationPlan("manual", "fixtures"), "skip");
  assert.equal(getFixtureAutomationPlan("manual", "results"), "score_local_state");
  assert.deepEqual(
    providerManagedMatchdays([
      { id: "manual", fixture_sync_mode: "manual" },
      { id: "provider", fixture_sync_mode: "provider" },
    ]),
    [{ id: "provider", fixture_sync_mode: "provider" }],
  );
});

test("provider matchdays retain authoritative fixture and result sync", () => {
  assert.equal(shouldSyncProviderFixtures("provider"), true);
  assert.equal(getFixtureAutomationPlan("provider", "fixtures"), "provider_sync");
  assert.equal(getFixtureAutomationPlan("provider", "results"), "provider_sync");
});

test("manual Matchday 2 fake finals cover ten unique fixtures and total 25 goals", () => {
  assert.equal(MATCHDAY_2_FINAL_SCORE_PLAN.length, 10);
  assert.equal(new Set(MATCHDAY_2_FINAL_SCORE_PLAN.map((fixture) => fixture.externalFixtureId)).size, 10);
  assert.equal(manualTestFinalGoalTotal(), 25);
});

test("manual Matchday 3 uses the exact synthetic fixture set and final-score plan", () => {
  assert.deepEqual(
    MATCHDAY_3_TEST_FIXTURE_IDS,
    Array.from({ length: 10 }, (_, index) => `990003${String(index + 1).padStart(3, "0")}`),
  );
  assert.deepEqual(
    MATCHDAY_3_FINAL_SCORE_PLAN.map((fixture) => fixture.externalFixtureId),
    MATCHDAY_3_TEST_FIXTURE_IDS,
  );
  assert.equal(new Set(MATCHDAY_3_TEST_FIXTURE_IDS).size, 10);
});

test("completed Matchday 2 yields current-matchday priority to upcoming Matchday 3", () => {
  const matchdays = [
    { id: "md2", matchday_number: 2, status: "completed", locks_at: "2026-08-10T09:00:00Z" },
    { id: "md3", matchday_number: 3, status: "upcoming", locks_at: "2026-09-05T09:00:00Z" },
  ];
  assert.equal(resolveDashboardMatchday(matchdays, Date.parse("2026-08-11T00:00:00Z"))?.id, "md3");
});

test("dashboard lifecycle uses player-facing open, in-progress and completed wording", () => {
  const now = Date.parse("2026-08-10T09:00:00Z");
  assert.equal(playerMatchdayLifecycle({ status: "open", locks_at: "2026-08-10T10:00:00Z" }, now), "Open");
  assert.equal(playerMatchdayLifecycle({ status: "scoring", locks_at: "2026-08-10T10:00:00Z" }, now), "In progress");
  assert.equal(playerMatchdayLifecycle({ status: "open", locks_at: "2026-08-10T09:00:00Z" }, now), "In progress");
  assert.equal(playerMatchdayLifecycle({ status: "completed", locks_at: "2026-08-10T09:00:00Z" }, now), "Completed");
});

test("a normally finalized submitted entry contributes to competition and overall standings", () => {
  const profile = { id: "player", display_name: "Player" };
  const matchday = { id: "md2", matchday_number: 2, status: "completed", locks_at: "2026-08-10T09:00:00Z" };
  const rows = buildStandings(
    [profile],
    [{ id: "entry", user_id: profile.id, matchday_id: matchday.id, submitted_at: "2026-08-09T00:00:00Z", calculated_score: 12 }],
    new Map([[matchday.id, matchday]]),
    { start: 1, end: 5 },
  );
  assert.deepEqual({ points: rows[0]?.points, played: rows[0]?.played, rank: rows[0]?.rank }, { points: 12, played: 1, rank: 1 });
});
