import test from "node:test";
import assert from "node:assert/strict";
import {
  getFixtureLifecycle,
  getMatchdayGoalProgress,
  earliestFixtureKickoff,
  formatPick8Kickoff,
  fixtureScoreStateLabel,
  isInitialPick8EntryWindowOpen,
  isFixtureSelectionEditable,
  isPick8SelectionVisible,
  isSubmittedFixturePickRevealable,
  canFinalizeBeforeConfiguredKickoffs,
  resolveMatchdayScoringStatus,
} from "../utils/pick8-fixture-state.ts";
import {
  isCompletePick8Entry,
  getPick8EntryState,
  getDuplicatePick8Categories,
  buildPick8EditorSnapshot,
  copyPick8EditorSnapshot,
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
  getDailyFixtureSyncMatchdayNumbers,
  getProviderPayloadMatchday,
  representSameKickoff,
} from "../utils/pick8-matchday-generation.ts";
import { resolveDefaultPicksMatchday } from "../utils/pick8-matchday-selection.ts";
import {
  acceleratedTestFinalScorePlan,
  canUseAcceleratedTestCompletion,
  MATCHDAY_2_FINAL_SCORE_PLAN,
  MATCHDAY_3_FINAL_SCORE_PLAN,
  MATCHDAY_3_TEST_FIXTURE_IDS,
  MATCHDAY_4_FINAL_SCORE_PLAN,
  MATCHDAY_4_TEST_FIXTURE_IDS,
  manualTestFinalGoalTotal,
} from "../utils/pick8-manual-test.ts";
import {
  calculatePick8FixtureSelectionPoints,
  getPick8FixtureSelectionOutcome,
  scorePick8TotalGoals,
  sumPick8Points,
} from "../utils/pick8-scoring-rules.ts";
import { findSubmittedPick8Player } from "../utils/pick8-breakdown-types.ts";
import {
  buildCurrentSubmissionRows,
  pick8SubmissionStatus,
  sortPick8AdminProfiles,
} from "../utils/pick8-admin-status.ts";
import { resolveCategoryMenuPlacement } from "../utils/category-select-position.ts";
import {
  buildStandings,
  currentCompetitionStandings,
  overallSeasonStandings,
  playerMatchdayLifecycle,
  resolveDashboardMatchday,
  resolveNextEditableDashboardMatchday,
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

test("fixture score state labels distinguish live and full time without labelling upcoming fixtures", () => {
  assert.equal(fixtureScoreStateLabel("upcoming"), null);
  assert.equal(fixtureScoreStateLabel("locked"), null);
  assert.equal(fixtureScoreStateLabel("live"), "LIVE");
  assert.equal(fixtureScoreStateLabel("finished"), "FT");
  assert.equal(fixtureScoreStateLabel("void"), null);
});

test("matchday running goals use started fixtures and remain separate from finalisation", () => {
  const now = Date.parse("2026-08-12T12:00:00Z");
  assert.deepEqual(getMatchdayGoalProgress([
    { kickoff_at: "2026-08-12T11:00:00Z", status: "in_play", home_score: 1, away_score: 0 },
    { kickoff_at: "2026-08-12T11:30:00Z", status: "in_play", home_score: 1, away_score: 1 },
    { kickoff_at: "2026-08-12T13:00:00Z", status: "scheduled", home_score: null, away_score: null },
  ], now), { hasStarted: true, currentGoals: 3 });
  assert.deepEqual(getMatchdayGoalProgress([
    { kickoff_at: "2026-08-12T13:00:00Z", status: "scheduled", home_score: null, away_score: null },
  ], now), { hasStarted: false, currentGoals: 0 });
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

test("admin submission status uses persisted entry state and operational ordering", () => {
  assert.equal(pick8SubmissionStatus(null), "not_submitted");
  assert.equal(pick8SubmissionStatus({ user_id: "draft", submitted_at: null }), "draft");
  assert.equal(pick8SubmissionStatus({ user_id: "submitted", submitted_at: "2026-08-15T00:00:00Z" }), "submitted");

  const profiles = [
    { id: "submitted", display_name: "Zoe", is_active: true, pick8_participation_active: true },
    { id: "draft", display_name: "Aaron", is_active: true, pick8_participation_active: true },
    { id: "missing-b", display_name: "Beth", is_active: true, pick8_participation_active: true },
    { id: "missing-a", display_name: "Adam", is_active: true, pick8_participation_active: true },
    { id: "paused", display_name: "Paused", is_active: true, pick8_participation_active: false },
  ];
  const rows = buildCurrentSubmissionRows(profiles, [
    { user_id: "submitted", submitted_at: "2026-08-15T00:00:00Z" },
    { user_id: "draft", submitted_at: null },
  ]);
  assert.deepEqual(rows.map((row) => [row.profile.id, row.status]), [
    ["missing-a", "not_submitted"],
    ["missing-b", "not_submitted"],
    ["draft", "draft"],
    ["submitted", "submitted"],
  ]);
});

test("admin users sort participating, paused, then inactive and alphabetically", () => {
  const profiles = [
    { id: "inactive", display_name: "Adam", is_active: false, pick8_participation_active: true },
    { id: "paused", display_name: "Beth", is_active: true, pick8_participation_active: false },
    { id: "active-z", display_name: "Zoe", is_active: true, pick8_participation_active: true },
    { id: "active-a", display_name: "Aaron", is_active: true, pick8_participation_active: true },
  ];
  assert.deepEqual(sortPick8AdminProfiles(profiles).map((profile) => profile.id), [
    "active-a",
    "active-z",
    "paused",
    "inactive",
  ]);
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

test("draft parsing permits temporary duplicate categories but completion rejects them", () => {
  const formData = new FormData();
  formData.set("fixture_category_one", "draw");
  formData.set("fixture_category_two", "draw");
  const parsed = parsePick8DraftSelections(formData, ["one", "two"]);
  assert.ok("selections" in parsed);
  assert.deepEqual(getDuplicatePick8Categories(parsed.selections), ["draw"]);
  assert.equal(isCompletePick8Entry(parsed.selections, 25), false);
});

test("submitted editor restores refreshed persisted values across repeated edit and cancel cycles", () => {
  const fixtureIds = ["one", "two"];
  const refreshed = buildPick8EditorSnapshot(fixtureIds, [
    { category: "draw", fixtureId: "one", selectedTeamSide: null },
    { category: "team_score", fixtureId: "two", selectedTeamSide: "away" },
  ], 31);

  const firstEdit = copyPick8EditorSnapshot(refreshed);
  firstEdit.choices.one = { category: "home_win", side: "home" };
  firstEdit.totalGoals = "28";

  const afterCancel = copyPick8EditorSnapshot(refreshed);
  assert.deepEqual(afterCancel.choices.one, { category: "draw", side: "" });
  assert.deepEqual(afterCancel.choices.two, { category: "team_score", side: "away" });
  assert.equal(afterCancel.totalGoals, "31");

  const secondEdit = copyPick8EditorSnapshot(refreshed);
  assert.deepEqual(secondEdit, afterCancel);
  assert.notEqual(secondEdit.choices, afterCancel.choices);
});

test("category menu prefers a full-height direction and scrolls only as fallback", () => {
  assert.deepEqual(resolveCategoryMenuPlacement({
    fullHeight: 330,
    availableBelow: 400,
    availableAbove: 500,
  }), { direction: "down", maxHeight: null });
  assert.deepEqual(resolveCategoryMenuPlacement({
    fullHeight: 330,
    availableBelow: 200,
    availableAbove: 350,
  }), { direction: "up", maxHeight: null });
  assert.deepEqual(resolveCategoryMenuPlacement({
    fullHeight: 330,
    availableBelow: 180,
    availableAbove: 240,
  }), { direction: "up", maxHeight: 240 });
  assert.deepEqual(resolveCategoryMenuPlacement({
    fullHeight: 330,
    availableBelow: 260.8,
    availableAbove: 190,
  }), { direction: "down", maxHeight: 260 });
});

test("live Pick8 outcome states use the same category semantics as final scoring", () => {
  const liveHomeLead = { status: "in_play", home_score: 2, away_score: 1 };
  const liveDraw = { status: "in_play", home_score: 1, away_score: 1 };
  assert.equal(getPick8FixtureSelectionOutcome({ category: "home_win", selected_team_side: "home" }, liveHomeLead), "positive");
  assert.equal(getPick8FixtureSelectionOutcome({ category: "away_win", selected_team_side: "away" }, liveHomeLead), "negative");
  assert.equal(getPick8FixtureSelectionOutcome({ category: "home_win", selected_team_side: "home" }, liveDraw), "neutral");
  assert.equal(getPick8FixtureSelectionOutcome({ category: "draw", selected_team_side: null }, liveDraw), "positive");
  assert.equal(getPick8FixtureSelectionOutcome({ category: "team_win", selected_team_side: "away" }, liveHomeLead), "negative");
  assert.equal(getPick8FixtureSelectionOutcome({ category: "team_lose", selected_team_side: "away" }, liveHomeLead), "positive");
  assert.equal(getPick8FixtureSelectionOutcome({ category: "team_score", selected_team_side: "away" }, { status: "in_play", home_score: 0, away_score: 0 }), "neutral");
  assert.equal(getPick8FixtureSelectionOutcome({ category: "team_score", selected_team_side: "away" }, liveHomeLead), "positive");
  assert.equal(getPick8FixtureSelectionOutcome({ category: "clean_sheet", selected_team_side: "home" }, { status: "in_play", home_score: 1, away_score: 0 }), "neutral");
  assert.equal(getPick8FixtureSelectionOutcome({ category: "clean_sheet", selected_team_side: "home" }, liveHomeLead), "negative");
  assert.equal(getPick8FixtureSelectionOutcome({ category: "clean_sheet", selected_team_side: "home" }, { status: "finished", home_score: 1, away_score: 0 }), "positive");
  assert.equal(getPick8FixtureSelectionOutcome({ category: "team_score", selected_team_side: "away" }, { status: "finished", home_score: 1, away_score: 0 }), "negative");
});

test("live Pick8 points recalculate from the current score without requiring final status", () => {
  const homeWinner = { category: "home_win" as const, selected_team_side: "home" as const };
  const teamWin = { category: "team_win" as const, selected_team_side: "home" as const };
  assert.deepEqual(calculatePick8FixtureSelectionPoints(homeWinner, { home_score: 1, away_score: 0 }), { pointsAwarded: 6, isCorrect: true });
  assert.deepEqual(calculatePick8FixtureSelectionPoints(teamWin, { home_score: 1, away_score: 0 }), { pointsAwarded: 10, isCorrect: true });
  assert.deepEqual(calculatePick8FixtureSelectionPoints(homeWinner, { home_score: 0, away_score: 1 }), { pointsAwarded: -5, isCorrect: false });
  assert.deepEqual(calculatePick8FixtureSelectionPoints(homeWinner, { home_score: 2, away_score: 0 }), { pointsAwarded: 7, isCorrect: true });
  assert.deepEqual(calculatePick8FixtureSelectionPoints({ category: "draw", selected_team_side: null }, { home_score: 1, away_score: 0 }), { pointsAwarded: 0, isCorrect: false });
});

test("current Matchday score sums shared card points and only legitimate Total Goals points", () => {
  assert.equal(sumPick8Points([6, 16, -10, null]), 12);
  assert.equal(sumPick8Points([6, 16, -10, null], 10), 22);
});

test("historical summary resolution uses only the current player's submitted entry", () => {
  const submittedPlayer = {
    player: { id: "sam", display_name: "Sam" },
    entry: { id: "entry", user_id: "sam", matchday_id: "md2", total_goals_prediction: 25, submitted_at: "2026-08-09T10:38:59Z", calculated_score: 16, score_calculated_at: "2026-08-10T00:00:00Z" },
    selections: [],
    totalGoalsPoints: 10,
  };
  const noEntryPlayer = {
    player: { id: "paul", display_name: "Paul" },
    entry: null,
    selections: [],
    totalGoalsPoints: null,
  };
  const players = [submittedPlayer, noEntryPlayer];
  assert.equal(findSubmittedPick8Player(players, "sam")?.entry?.total_goals_prediction, 25);
  assert.equal(findSubmittedPick8Player(players, "paul"), null);
  assert.equal(findSubmittedPick8Player(players, "missing"), null);
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

test("daily fixture automation creates three upcoming provider rounds before the current round completes", () => {
  assert.deepEqual(
    getDailyFixtureSyncMatchdayNumbers([
      { matchday_number: 1, status: "scoring", fixture_sync_mode: "provider" },
    ]),
    [1, 2, 3, 4],
  );
});

test("the Picks page defaults to Matchday 2 as soon as it is populated", () => {
  const now = Date.parse("2026-08-25T07:00:00Z");
  assert.equal(
    resolveDefaultPicksMatchday([
      { matchday_number: 1, status: "completed", locks_at: "2026-08-21T19:00:00Z" },
      { matchday_number: 2, status: "upcoming", locks_at: "2026-08-28T19:00:00Z" },
    ], now)?.matchday_number,
    2,
  );
});

test("daily fixture automation tops up its lookahead after completion and is idempotent", () => {
  const matchdays = [
    { matchday_number: 1, status: "completed", fixture_sync_mode: "provider" as const },
    { matchday_number: 2, status: "upcoming", fixture_sync_mode: "provider" as const },
    { matchday_number: 3, status: "upcoming", fixture_sync_mode: "provider" as const },
    { matchday_number: 4, status: "upcoming", fixture_sync_mode: "provider" as const },
  ];
  assert.deepEqual(getDailyFixtureSyncMatchdayNumbers(matchdays), [2, 3, 4]);
  assert.deepEqual(getDailyFixtureSyncMatchdayNumbers(matchdays), [2, 3, 4]);

  matchdays[1] = { ...matchdays[1], status: "completed" };
  assert.deepEqual(getDailyFixtureSyncMatchdayNumbers(matchdays), [3, 4, 5]);
});

test("fixture generation fills round gaps without provider-syncing manual matchdays", () => {
  assert.deepEqual(
    getDailyFixtureSyncMatchdayNumbers([
      { matchday_number: 1, status: "completed", fixture_sync_mode: "provider" },
      { matchday_number: 3, status: "upcoming", fixture_sync_mode: "manual" },
    ]),
    [2, 4],
  );
});

test("provider payloads must identify the requested round at the response boundary", () => {
  assert.equal(getProviderPayloadMatchday({ matchday: 2, fixtures: [] }), 2);
  assert.equal(getProviderPayloadMatchday({ matchdayNumber: "3" }), 3);
  assert.equal(getProviderPayloadMatchday({ fixtures: [] }), null);
  assert.equal(getProviderPayloadMatchday([{ matchday: 2 }]), null);
});

test("fixture sync treats equivalent database and provider timestamp formats as unchanged", () => {
  assert.equal(
    representSameKickoff(
      "2026-08-28T19:00:00+00:00",
      "2026-08-28T19:00:00.000Z",
    ),
    true,
  );
  assert.equal(
    representSameKickoff(
      "2026-08-28T19:00:00+00:00",
      "2026-08-28T19:01:00.000Z",
    ),
    false,
  );
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

test("ordinary scoring cannot bypass future kickoffs for real or synthetic matchdays", () => {
  assert.equal(canFinalizeBeforeConfiguredKickoffs({
    allowAcceleratedTestCompletion: true,
    fixtureSyncMode: "provider",
    isAcceleratedTest: false,
  }), false);
  assert.equal(canFinalizeBeforeConfiguredKickoffs({
    allowAcceleratedTestCompletion: false,
    fixtureSyncMode: "manual",
    isAcceleratedTest: true,
  }), false);
});

test("only the confirmed authorised accelerated action can complete a marked synthetic matchday early", () => {
  const common = {
    fixtureSyncMode: "manual",
    isAcceleratedTest: true,
    matchdayNumber: 3,
    fixtureIds: MATCHDAY_3_TEST_FIXTURE_IDS,
  };
  assert.equal(canUseAcceleratedTestCompletion({ ...common, isAuthorizedAdmin: false, confirmed: true }), false);
  assert.equal(canUseAcceleratedTestCompletion({ ...common, isAuthorizedAdmin: true, confirmed: false }), false);
  assert.equal(canUseAcceleratedTestCompletion({ ...common, isAuthorizedAdmin: true, confirmed: true }), true);
  assert.equal(canFinalizeBeforeConfiguredKickoffs({
    allowAcceleratedTestCompletion: true,
    fixtureSyncMode: common.fixtureSyncMode,
    isAcceleratedTest: common.isAcceleratedTest,
  }), true);
});

test("accelerated finals feed the same Total Goals scoring rule as normal finals", () => {
  assert.deepEqual(
    MATCHDAY_4_FINAL_SCORE_PLAN.map(({ homeScore, awayScore }) => [homeScore, awayScore]),
    MATCHDAY_3_FINAL_SCORE_PLAN.map(({ homeScore, awayScore }) => [homeScore, awayScore]),
  );
  const actualGoals = acceleratedTestFinalScorePlan(4).reduce((total, fixture) => total + fixture.homeScore + fixture.awayScore, 0);
  assert.equal(scorePick8TotalGoals({ prediction: actualGoals, actualGoals, finalScoringReady: true }), 10);
  assert.equal(scorePick8TotalGoals({ prediction: actualGoals - 1, actualGoals, finalScoringReady: true }), 0);
});

test("completed Matchday 3 allows Manual Matchday 4 to become current", () => {
  assert.equal(MATCHDAY_4_TEST_FIXTURE_IDS.length, 10);
  const matchdays = [
    { id: "md3", matchday_number: 3, status: "completed", locks_at: "2026-08-12T10:00:00Z" },
    { id: "md4", matchday_number: 4, status: "open", locks_at: "2026-08-14T10:00:00Z" },
  ];
  assert.equal(resolveDashboardMatchday(matchdays, Date.parse("2026-08-13T00:00:00Z"))?.id, "md4");
});

test("a scoring matchday stays primary while future matchdays are open for picks", () => {
  const now = Date.parse("2026-08-13T00:00:00Z");
  const matchdays = [
    { id: "md2", matchday_number: 2, status: "scoring", locks_at: "2026-08-12T10:00:00Z" },
    { id: "md3", matchday_number: 3, status: "open", locks_at: "2026-08-20T10:00:00Z" },
    { id: "md4", matchday_number: 4, status: "upcoming", locks_at: "2026-08-27T10:00:00Z" },
  ];
  const primary = resolveDashboardMatchday(matchdays, now);
  assert.equal(primary?.id, "md2");
  assert.equal(resolveNextEditableDashboardMatchday(matchdays, primary, now)?.id, "md3");
});

test("the earliest open matchday stays primary when no matchday is scoring", () => {
  const matchdays = [
    { id: "md2", matchday_number: 2, status: "open", locks_at: "2026-08-14T10:00:00Z" },
    { id: "md3", matchday_number: 3, status: "upcoming", locks_at: "2026-08-21T10:00:00Z" },
  ];
  assert.equal(resolveDashboardMatchday(matchdays, Date.parse("2026-08-13T00:00:00Z"))?.id, "md2");
});

test("future entry state does not displace a scoring dashboard matchday", () => {
  const matchdays = [
    { id: "md2", matchday_number: 2, status: "scoring", locks_at: "2026-08-12T10:00:00Z" },
    { id: "md3", matchday_number: 3, status: "open", locks_at: "2026-08-20T10:00:00Z" },
  ];
  const submittedEntries = [{ matchday_id: "md3", submitted_at: "2026-08-12T09:00:00Z" }];
  assert.equal(submittedEntries[0]?.matchday_id, "md3");
  assert.equal(resolveDashboardMatchday(matchdays, Date.parse("2026-08-13T00:00:00Z"))?.id, "md2");
});

test("completed Matchday 2 yields current-matchday priority to upcoming Matchday 3", () => {
  const matchdays = [
    { id: "md2", matchday_number: 2, status: "completed", locks_at: "2026-08-10T09:00:00Z" },
    { id: "md3", matchday_number: 3, status: "upcoming", locks_at: "2026-09-05T09:00:00Z" },
  ];
  assert.equal(resolveDashboardMatchday(matchdays, Date.parse("2026-08-11T00:00:00Z"))?.id, "md3");
});

test("a locked matchday remains current instead of falling back to history", () => {
  const matchdays = [
    { id: "md3", matchday_number: 3, status: "completed", locks_at: "2026-08-10T09:00:00Z" },
    { id: "md4", matchday_number: 4, status: "locked", locks_at: "2026-08-15T09:00:00Z" },
  ];
  assert.equal(resolveDashboardMatchday(matchdays, Date.parse("2026-08-15T09:01:00Z"))?.id, "md4");
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

test("paused participation preserves history, records missed matchdays, and resumes without backfill", () => {
  const disabled = { id: "player", display_name: "Player", pick8_participation_active: false };
  const enabled = { ...disabled, pick8_participation_active: true };
  const opponent = { id: "opponent", display_name: "Opponent", pick8_participation_active: true };
  const matchdays = [
    { id: "md1", matchday_number: 1, status: "completed", locks_at: "2026-08-01T10:00:00Z" },
    { id: "md2", matchday_number: 2, status: "completed", locks_at: "2026-08-08T10:00:00Z" },
    { id: "md3", matchday_number: 3, status: "completed", locks_at: "2026-08-15T10:00:00Z" },
  ];
  const matchdayById = new Map(matchdays.map((matchday) => [matchday.id, matchday]));
  const historicalEntry = { id: "entry-1", user_id: disabled.id, matchday_id: "md1", submitted_at: "2026-08-01T09:00:00Z", calculated_score: 18 };
  const opponentEntry = { id: "entry-2", user_id: opponent.id, matchday_id: "md2", submitted_at: "2026-08-08T09:00:00Z", calculated_score: 12 };

  const pausedOverall = buildStandings([disabled, opponent], [historicalEntry, opponentEntry], matchdayById);
  assert.deepEqual(
    pausedOverall.find((row) => row.profile.id === disabled.id) && {
      points: pausedOverall.find((row) => row.profile.id === disabled.id)?.points,
      played: pausedOverall.find((row) => row.profile.id === disabled.id)?.played,
    },
    { points: 18, played: 1 },
  );
  assert.equal(currentCompetitionStandings(buildStandings([disabled], [historicalEntry], matchdayById, { start: 1, end: 2 })).length, 1);
  assert.equal(currentCompetitionStandings(buildStandings([disabled], [historicalEntry], matchdayById, { start: 2, end: 3 })).length, 0);
  const activeNegativeEntry = { id: "entry-negative", user_id: opponent.id, matchday_id: "md2", submitted_at: "2026-08-08T09:00:00Z", calculated_score: -5 };
  const reranked = currentCompetitionStandings(buildStandings([disabled, opponent], [historicalEntry, activeNegativeEntry], matchdayById, { start: 2, end: 3 }));
  assert.deepEqual(reranked.map((row) => ({ id: row.profile.id, rank: row.rank })), [{ id: opponent.id, rank: 1 }]);

  const resumedWithoutBackfill = buildStandings([enabled], [historicalEntry], matchdayById);
  assert.deepEqual({ points: resumedWithoutBackfill[0]?.points, played: resumedWithoutBackfill[0]?.played }, { points: 18, played: 1 });
  const resumedEntry = { id: "entry-3", user_id: enabled.id, matchday_id: "md3", submitted_at: "2026-08-15T09:00:00Z", calculated_score: 9 };
  const resumedOverall = buildStandings([enabled], [historicalEntry, resumedEntry], matchdayById);
  assert.deepEqual({ points: resumedOverall[0]?.points, played: resumedOverall[0]?.played }, { points: 27, played: 2 });
});

test("account deactivation hides no earned historical leaderboard score", () => {
  const inactive = { id: "inactive", display_name: "Inactive", is_active: false, pick8_participation_active: false };
  const active = { id: "active", display_name: "Active", is_active: true, pick8_participation_active: true };
  const matchday = { id: "md1", matchday_number: 1, status: "completed", locks_at: "2026-08-01T10:00:00Z" };
  const rows = buildStandings(
    [inactive, active],
    [{ id: "historic", user_id: inactive.id, matchday_id: matchday.id, submitted_at: "2026-08-01T09:00:00Z", calculated_score: 14 }],
    new Map([[matchday.id, matchday]]),
  );
  const visible = overallSeasonStandings(rows);
  assert.equal(visible.find((row) => row.profile.id === inactive.id)?.points, 14);
  assert.equal(visible.some((row) => row.profile.id === active.id), true);
});
