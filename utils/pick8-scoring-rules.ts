export type Pick8ScoringCategory =
  | "home_win"
  | "away_win"
  | "draw"
  | "team_win"
  | "team_lose"
  | "team_score"
  | "clean_sheet";
export type Pick8ScoringTeamSide = "home" | "away" | null;
export type Pick8OutcomeState = "positive" | "negative" | "neutral";

export type Pick8ScoreFixture = {
  status: string;
  home_score: number | null;
  away_score: number | null;
};

export type Pick8ScoreSelection = {
  category: Pick8ScoringCategory;
  selected_team_side: Pick8ScoringTeamSide;
};

export type Pick8SelectionPoints = {
  pointsAwarded: number;
  isCorrect: boolean;
};

export function sumPick8Points(
  selectionPoints: Array<number | null>,
  totalGoalsPoints: number | null = null,
) {
  return selectionPoints.reduce<number>(
    (total, points) => total + (points ?? 0),
    totalGoalsPoints ?? 0,
  );
}

export function getPick8SelectedTeamPerformance(
  fixture: Pick<Pick8ScoreFixture, "home_score" | "away_score">,
  side: Exclude<Pick8ScoringTeamSide, null>,
) {
  if (fixture.home_score === null || fixture.away_score === null) {
    throw new Error("Fixture scores are required.");
  }
  const goalsFor = side === "home" ? fixture.home_score : fixture.away_score;
  const goalsAgainst = side === "home" ? fixture.away_score : fixture.home_score;
  return {
    result: goalsFor > goalsAgainst ? "win" as const : goalsFor < goalsAgainst ? "loss" as const : "draw" as const,
    goalsFor,
    goalsAgainst,
    goalDifference: Math.abs(goalsFor - goalsAgainst),
  };
}

export function isPick8FixtureSelectionSatisfied(
  selection: Pick8ScoreSelection,
  fixture: Pick<Pick8ScoreFixture, "home_score" | "away_score">,
) {
  if (fixture.home_score === null || fixture.away_score === null) return null;
  const side = selection.category === "home_win"
    ? "home"
    : selection.category === "away_win"
      ? "away"
      : selection.selected_team_side;
  if (selection.category === "draw") return fixture.home_score === fixture.away_score;
  if (side !== "home" && side !== "away") return null;
  const performance = getPick8SelectedTeamPerformance(fixture, side);
  if (selection.category === "home_win" || selection.category === "away_win" || selection.category === "team_win") {
    return performance.result === "win";
  }
  if (selection.category === "team_lose") return performance.result === "loss";
  if (selection.category === "team_score") return performance.goalsFor > 0;
  return performance.goalsAgainst === 0;
}

export function calculatePick8FixtureSelectionPoints(
  selection: Pick8ScoreSelection,
  fixture: Pick<Pick8ScoreFixture, "home_score" | "away_score">,
): Pick8SelectionPoints | null {
  if (fixture.home_score === null || fixture.away_score === null) return null;
  if (selection.category === "home_win") {
    const performance = getPick8SelectedTeamPerformance(fixture, "home");
    return performance.result === "win"
      ? { pointsAwarded: 5 + performance.goalDifference, isCorrect: true }
      : performance.result === "loss"
        ? { pointsAwarded: -5 * performance.goalDifference, isCorrect: false }
        : { pointsAwarded: 0, isCorrect: false };
  }
  if (selection.category === "away_win") {
    const performance = getPick8SelectedTeamPerformance(fixture, "away");
    return performance.result === "win"
      ? { pointsAwarded: 10 + performance.goalDifference, isCorrect: true }
      : performance.result === "loss"
        ? { pointsAwarded: -5 * performance.goalDifference, isCorrect: false }
        : { pointsAwarded: 0, isCorrect: false };
  }
  const correct = isPick8FixtureSelectionSatisfied(selection, fixture) ?? false;
  if (selection.category === "draw") {
    return {
      pointsAwarded: correct ? 15 + fixture.home_score : 0,
      isCorrect: correct,
    };
  }
  return { pointsAwarded: correct ? 10 : -10, isCorrect: correct };
}

export function getPick8FixtureSelectionOutcome(
  selection: Pick8ScoreSelection,
  fixture: Pick8ScoreFixture,
): Pick8OutcomeState {
  if (fixture.home_score === null || fixture.away_score === null) return "neutral";
  const finished = fixture.status === "finished";
  const satisfied = isPick8FixtureSelectionSatisfied(selection, fixture);
  if (finished) return satisfied ? "positive" : "negative";

  const side = selection.category === "home_win"
    ? "home"
    : selection.category === "away_win"
      ? "away"
      : selection.selected_team_side;
  if (selection.category === "draw") return satisfied ? "positive" : "negative";
  if (side !== "home" && side !== "away") return "neutral";
  const performance = getPick8SelectedTeamPerformance(fixture, side);
  if (selection.category === "team_score") return performance.goalsFor > 0 ? "positive" : "neutral";
  if (selection.category === "clean_sheet") return performance.goalsAgainst > 0 ? "negative" : "neutral";
  if (selection.category === "team_lose") {
    return performance.result === "loss" ? "positive" : performance.result === "win" ? "negative" : "neutral";
  }
  return performance.result === "win" ? "positive" : performance.result === "loss" ? "negative" : "neutral";
}

export function scorePick8TotalGoals({
  prediction,
  actualGoals,
  finalScoringReady,
}: {
  prediction: number | null;
  actualGoals: number | null;
  finalScoringReady: boolean;
}) {
  if (!finalScoringReady) return null;
  return prediction !== null && prediction === actualGoals ? 10 : 0;
}
