import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";
import { resolveMatchdayScoringStatus } from "@/utils/pick8-fixture-state";

export type SelectionCategory =
  | "home_win"
  | "away_win"
  | "draw"
  | "team_win"
  | "team_lose"
  | "team_score"
  | "clean_sheet";
export type TeamSide = "home" | "away" | null;

export type ScoringFixture = {
  id: string;
  kickoff_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
};

export type ScoringSelection = {
  id: string;
  category: SelectionCategory;
  fixture_id: string;
  selected_team_side: TeamSide;
};

export type SelectionScore = {
  pointsAwarded: number | null;
  isCorrect: boolean | null;
};

export type SelectedTeamPerformance = {
  result: "win" | "draw" | "loss";
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
};

export type EntryScoreResult = {
  selectionScores: Array<ScoringSelection & SelectionScore>;
  fixturePoints: number;
  totalGoalsPoints: number | null;
  calculatedScore: number | null;
};

export type ScoreRecalculationSummary = {
  seasonId: string;
  matchdayId: string;
  matchdayNumber: number;
  entriesFound: number;
  selectionsScored: number;
  selectionsAwaitingResults: number;
  voidSelections: number;
  entriesFinalized: number;
  entriesSkipped: number;
  finalScoringReady: boolean;
  recalculatedAt: string;
};

const TERMINAL_STATUSES = new Set(["finished", "postponed", "cancelled"]);
const VOID_STATUSES = new Set(["postponed", "cancelled"]);

export function getSelectedTeamPerformance(
  fixture: Pick<ScoringFixture, "home_score" | "away_score">,
  side: Exclude<TeamSide, null>,
): SelectedTeamPerformance {
  if (fixture.home_score === null || fixture.away_score === null) {
    throw new Error("Finished fixture scores are required.");
  }
  const goalsFor = side === "home" ? fixture.home_score : fixture.away_score;
  const goalsAgainst = side === "home" ? fixture.away_score : fixture.home_score;
  return {
    result: goalsFor > goalsAgainst ? "win" : goalsFor < goalsAgainst ? "loss" : "draw",
    goalsFor,
    goalsAgainst,
    goalDifference: Math.abs(goalsFor - goalsAgainst),
  };
}

export function scoreFixtureSelection(
  selection: Pick<ScoringSelection, "category" | "selected_team_side">,
  fixture: ScoringFixture,
): SelectionScore {
  if (
    fixture.status !== "finished" ||
    fixture.home_score === null ||
    fixture.away_score === null
  ) {
    return { pointsAwarded: null, isCorrect: null };
  }

  switch (selection.category) {
    case "home_win": {
      const performance = getSelectedTeamPerformance(fixture, "home");
      return performance.result === "win"
        ? { pointsAwarded: 5 + performance.goalDifference, isCorrect: true }
        : performance.result === "loss"
          ? { pointsAwarded: -5 * performance.goalDifference, isCorrect: false }
          : { pointsAwarded: 0, isCorrect: false };
    }
    case "away_win": {
      const performance = getSelectedTeamPerformance(fixture, "away");
      return performance.result === "win"
        ? { pointsAwarded: 10 + performance.goalDifference, isCorrect: true }
        : performance.result === "loss"
          ? { pointsAwarded: -5 * performance.goalDifference, isCorrect: false }
          : { pointsAwarded: 0, isCorrect: false };
    }
    case "draw": {
      const correct = fixture.home_score === fixture.away_score;
      return {
        pointsAwarded: correct ? 15 + fixture.home_score : 0,
        isCorrect: correct,
      };
    }
    case "team_win":
    case "team_lose":
    case "team_score":
    case "clean_sheet": {
      if (selection.selected_team_side !== "home" && selection.selected_team_side !== "away") {
        throw new Error(`Category ${selection.category} requires a selected team.`);
      }
      const performance = getSelectedTeamPerformance(
        fixture,
        selection.selected_team_side,
      );
      const correct =
        selection.category === "team_win"
          ? performance.result === "win"
          : selection.category === "team_lose"
            ? performance.result === "loss"
            : selection.category === "team_score"
              ? performance.goalsFor > 0
              : performance.goalsAgainst === 0;
      return { pointsAwarded: correct ? 10 : -10, isCorrect: correct };
    }
    default: {
      const exhaustive: never = selection.category;
      throw new Error(`Unsupported selection category: ${exhaustive}`);
    }
  }
}

export function isMatchdayReadyForFinalScoring(fixtures: ScoringFixture[]) {
  return fixtures.length > 0 && fixtures.every((fixture) => TERMINAL_STATUSES.has(fixture.status));
}

export function calculateCompletedMatchdayGoalTotal(fixtures: ScoringFixture[]) {
  if (!isMatchdayReadyForFinalScoring(fixtures)) return null;
  return fixtures.reduce((total, fixture) => {
    if (
      fixture.status !== "finished" ||
      fixture.home_score === null ||
      fixture.away_score === null
    ) {
      return total;
    }
    return total + fixture.home_score + fixture.away_score;
  }, 0);
}

export function scoreEntry({
  selections,
  fixturesById,
  totalGoalsPrediction,
  finalScoringReady,
  completedGoalTotal,
}: {
  selections: ScoringSelection[];
  fixturesById: Map<string, ScoringFixture>;
  totalGoalsPrediction: number | null;
  finalScoringReady: boolean;
  completedGoalTotal: number | null;
}): EntryScoreResult {
  const selectionScores = selections.map((selection) => {
    const fixture = fixturesById.get(selection.fixture_id);
    if (!fixture) throw new Error(`Fixture ${selection.fixture_id} was not found.`);
    return { ...selection, ...scoreFixtureSelection(selection, fixture) };
  });
  const fixturePoints = selectionScores.reduce(
    (total, selection) => total + (selection.pointsAwarded ?? 0),
    0,
  );
  const totalGoalsPoints = finalScoringReady
    ? totalGoalsPrediction !== null && totalGoalsPrediction === completedGoalTotal
      ? 10
      : 0
    : null;
  return {
    selectionScores,
    fixturePoints,
    totalGoalsPoints,
    calculatedScore: finalScoringReady
      ? fixturePoints + (totalGoalsPoints ?? 0)
      : null,
  };
}

function databaseFailure(operation: string, message: string): never {
  throw new Error(`${operation} failed: ${message}`);
}

export async function recalculateMatchdayScores({
  seasonId,
  matchdayId,
}: {
  seasonId: string;
  matchdayId: string;
}): Promise<ScoreRecalculationSummary> {
  const supabase = createAdminClient();
  const recalculatedAt = new Date().toISOString();
  const { data: matchday, error: matchdayError } = await supabase
    .from("matchdays")
    .select("id, season_id, matchday_number, status")
    .eq("id", matchdayId)
    .eq("season_id", seasonId)
    .maybeSingle();
  if (matchdayError) databaseFailure("Reading matchday", matchdayError.message);
  if (!matchday) throw new Error("The selected matchday does not belong to that season.");

  const { data: fixtureRows, error: fixtureError } = await supabase
    .from("fixtures")
    .select("id, kickoff_at, status, home_score, away_score")
    .eq("matchday_id", matchdayId);
  if (fixtureError) databaseFailure("Reading fixtures", fixtureError.message);
  const fixtures = (fixtureRows ?? []) as ScoringFixture[];
  const fixturesById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const finalScoringReady = isMatchdayReadyForFinalScoring(fixtures);
  const completedGoalTotal = calculateCompletedMatchdayGoalTotal(fixtures);

  const { data: entries, error: entriesError } = await supabase
    .from("entries")
    .select("id, total_goals_prediction")
    .eq("matchday_id", matchdayId)
    .not("submitted_at", "is", null);
  if (entriesError) databaseFailure("Reading entries", entriesError.message);
  const entryRows = entries ?? [];

  // Drafts are never competition entries. Clear any score left by an older
  // recalculation path so they cannot leak into tables or result labels.
  const { error: draftResetError } = await supabase
    .from("entries")
    .update({ calculated_score: null, score_calculated_at: null, updated_at: recalculatedAt })
    .eq("matchday_id", matchdayId)
    .is("submitted_at", null);
  if (draftResetError) databaseFailure("Resetting draft scores", draftResetError.message);
  const entryIds = entryRows.map((entry) => entry.id);
  const { data: selections, error: selectionsError } = entryIds.length
    ? await supabase
        .from("entry_selections")
        .select("id, entry_id, category, fixture_id, selected_team_side")
        .in("entry_id", entryIds)
    : { data: [], error: null };
  if (selectionsError) databaseFailure("Reading selections", selectionsError.message);

  let selectionsScored = 0;
  let selectionsAwaitingResults = 0;
  let voidSelections = 0;
  for (const entry of entryRows) {
    const entrySelections = (selections ?? [])
      .filter((selection) => selection.entry_id === entry.id)
      .map((selection) => ({
        id: selection.id,
        category: selection.category as SelectionCategory,
        fixture_id: selection.fixture_id,
        selected_team_side: selection.selected_team_side as TeamSide,
      }));
    const result = scoreEntry({
      selections: entrySelections,
      fixturesById,
      totalGoalsPrediction: entry.total_goals_prediction,
      finalScoringReady,
      completedGoalTotal,
    });

    for (const selection of result.selectionScores) {
      const fixture = fixturesById.get(selection.fixture_id)!;
      if (selection.pointsAwarded !== null) selectionsScored += 1;
      else if (VOID_STATUSES.has(fixture.status)) voidSelections += 1;
      else selectionsAwaitingResults += 1;
      const { error } = await supabase
        .from("entry_selections")
        .update({
          points_awarded: selection.pointsAwarded,
          is_correct: selection.isCorrect,
          updated_at: recalculatedAt,
        })
        .eq("id", selection.id)
        .eq("entry_id", entry.id);
      if (error) databaseFailure("Updating selection score", error.message);
    }

    const { error: entryUpdateError } = await supabase
      .from("entries")
      .update({
        calculated_score: result.calculatedScore,
        score_calculated_at: finalScoringReady ? recalculatedAt : null,
        updated_at: recalculatedAt,
      })
      .eq("id", entry.id)
      .eq("matchday_id", matchdayId);
    if (entryUpdateError) databaseFailure("Updating entry score", entryUpdateError.message);
  }

  const { error: statusError } = await supabase
    .from("matchdays")
    .update({
      status: resolveMatchdayScoringStatus({
        currentStatus: matchday.status,
        fixtures,
        finalScoringReady,
        now: Date.parse(recalculatedAt),
      }),
      updated_at: recalculatedAt,
    })
    .eq("id", matchdayId)
    .eq("season_id", seasonId);
  if (statusError) databaseFailure("Updating matchday status", statusError.message);

  return {
    seasonId,
    matchdayId,
    matchdayNumber: matchday.matchday_number,
    entriesFound: entryRows.length,
    selectionsScored,
    selectionsAwaitingResults,
    voidSelections,
    entriesFinalized: finalScoringReady ? entryRows.length : 0,
    entriesSkipped: finalScoringReady ? 0 : entryRows.length,
    finalScoringReady,
    recalculatedAt,
  };
}
