import { cronRead, currentCronReadContext, isAmbiguousWriteResult, structuredCronError } from "@/utils/supabase/cron-read";
import "server-only";

import { createSyncDiagnostics } from "@/utils/pick8-sync-diagnostics";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  calculatePick8FixtureSelectionPoints,
  getPick8SelectedTeamPerformance,
  scorePick8TotalGoals,
} from "@/utils/pick8-scoring-rules";

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
  matchdayStatus: string;
  requestedScoringRevision: number;
  acknowledgedRevision: number;
  selectionRowsConsidered: number;
  selectionRowsChanged: number;
  entryRowsConsidered: number;
  entryRowsChanged: number;
  reused: boolean;
};

const TERMINAL_STATUSES = new Set(["finished", "postponed", "cancelled"]);

export function getSelectedTeamPerformance(
  fixture: Pick<ScoringFixture, "home_score" | "away_score">,
  side: Exclude<TeamSide, null>,
): SelectedTeamPerformance {
  return getPick8SelectedTeamPerformance(fixture, side);
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
  if (
    ["team_win", "team_lose", "team_score", "clean_sheet"].includes(selection.category) &&
    selection.selected_team_side !== "home" &&
    selection.selected_team_side !== "away"
  ) {
    throw new Error(`Category ${selection.category} requires a selected team.`);
  }

  const result = calculatePick8FixtureSelectionPoints(selection, fixture);
  if (!result) {
    throw new Error("Finished fixture scores are required.");
  }
  return result;
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
  const totalGoalsPoints = scorePick8TotalGoals({
    prediction: totalGoalsPrediction,
    actualGoals: completedGoalTotal,
    finalScoringReady,
  });
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

// Five seconds for the RPC, with at least four seconds left for read-back and
// fixture acknowledgement. Admission happens AFTER pending is durable.
export const SCORING_RPC_TIMEOUT_MS = 5_000;
export const SCORING_ADMISSION_MS = 9_000;

export class ScoringDeferredError extends Error {
  constructor(public readonly matchdayId: string, public readonly revision: number, reason: string) {
    super(reason);
    this.name = "ScoringDeferredError";
  }
}

type ScoringCheckpoint = {
  scoring_revision: number;
  scored_revision: number | null;
  scoring_pending: boolean;
  scoring_result: unknown;
  status: string;
};

function committedResult(state: ScoringCheckpoint, revision: number): ScoreRecalculationSummary | null {
  const result = state.scoring_result as ScoreRecalculationSummary | null;
  return state.scoring_revision === revision && state.scored_revision === revision &&
    !state.scoring_pending && result?.acknowledgedRevision === revision &&
    result.matchdayStatus === state.status ? result : null;
}

export async function recalculateMatchdayScores(input: {
  seasonId: string;
  matchdayId: string;
  allowAcceleratedTestCompletion?: boolean;
  reuseAcknowledged?: boolean;
}): Promise<ScoreRecalculationSummary> {
  const diagnostics = createSyncDiagnostics({ operation: "recalculate-scores", matchdayId: input.matchdayId });
  return diagnostics.stage("scoring", async () => {
    const supabase = createAdminClient();
    const context = currentCronReadContext();
    const { data: state, error } = await cronRead("scoring.checkpoint", () => supabase.from("matchdays")
      .select("scoring_revision, scored_revision, scoring_pending, scoring_result, status")
      .eq("id", input.matchdayId).eq("season_id", input.seasonId).single());
    if (error) databaseFailure("Reading scoring checkpoint", error.message);
    if (!state) throw new Error("The selected matchday does not belong to that season.");
    const revision = state.scoring_revision;
    const report = (fields: Record<string, unknown>) => diagnostics.event({
      service: "pick8-scoring-rpc", requestedScoringRevision: revision,
      acknowledgedRevision: null, rpcDurationMs: 0, selectionRowsConsidered: null,
      selectionRowsChanged: null, entryRowsConsidered: null, entryRowsChanged: null, matchdayStatus: null,
      remainingBudgetMs: context ? Math.round(context.remaining()) : null, ...fields,
    });
    const committed = committedResult(state, revision);
    if (input.reuseAcknowledged && committed) {
      report({ ...committed, selectionRowsChanged: 0, entryRowsChanged: 0,
        rpcDurationMs: 0, outcome: "checkpoint_reused" });
      return { ...committed, selectionRowsChanged: 0, entryRowsChanged: 0, reused: true };
    }
    if (!state.scoring_pending) {
      const { data: pending, error: pendingError } = await supabase.from("matchdays")
        .update({ scoring_pending: true }).eq("id", input.matchdayId).eq("season_id", input.seasonId)
        .eq("scoring_revision", revision).select("id").maybeSingle();
      if (pendingError) databaseFailure("Marking scoring pending", pendingError.message);
      if (!pending) throw new Error("Scoring inputs changed before scoring; retry required.");
    }
    if (context && context.remaining() < SCORING_ADMISSION_MS) {
      report({ outcome: "deferred", rpcDurationMs: 0, acknowledgedRevision: null });
      throw new ScoringDeferredError(input.matchdayId, revision, "Insufficient scoring budget; durable work deferred.");
    }
    const started = performance.now();
    // A mutation is attempted once. Never put this RPC through cronRead.
    const response = await supabase.rpc("score_pick8_matchday", {
      check_season_id: input.seasonId, check_matchday_id: input.matchdayId,
      check_scoring_revision: revision,
      allow_accelerated_test_completion: input.allowAcceleratedTestCompletion ?? false,
    }).retry(false).abortSignal(AbortSignal.timeout(SCORING_RPC_TIMEOUT_MS));
    const rpcDurationMs = Math.round(performance.now() - started);
    if (!response.error && response.data) {
      const result = response.data as unknown as ScoreRecalculationSummary;
      if (result.acknowledgedRevision !== revision || result.requestedScoringRevision !== revision ||
        result.matchdayId !== input.matchdayId || result.seasonId !== input.seasonId) {
        databaseFailure("Scoring transaction", "Unexpected scoring acknowledgement.");
      }
      report({ ...result, rpcDurationMs, outcome: "committed" });
      return result;
    }
    const ambiguous = isAmbiguousWriteResult(response);
    report({ rpcDurationMs, outcome: ambiguous ? "ambiguous_response" : "failed",
      acknowledgedRevision: null, ...structuredCronError(response) });
    if (ambiguous) {
      const { data: checkpoint, error: readError } = await cronRead("scoring.acknowledgement_readback", () => supabase.from("matchdays")
        .select("scoring_revision, scored_revision, scoring_pending, scoring_result, status")
        .eq("id", input.matchdayId).eq("season_id", input.seasonId).single());
      const result = !readError && checkpoint ? committedResult(checkpoint, revision) : null;
      report({ ...(result ?? {}), rpcDurationMs, outcome: "readback", readbackOutcome: result ? "committed" : readError ? "unavailable" : "not_acknowledged",
        acknowledgedRevision: checkpoint?.scored_revision ?? null });
      if (result) return result;
      // Never write in recovery: a newer worker may already have committed.
      throw new ScoringDeferredError(input.matchdayId, revision, "Scoring outcome unconfirmed; durable work will be checked next invocation.");
    }
    if (["55P03", "40P01", "40001", "57014"].includes(response.error?.code ?? "")) {
      throw new ScoringDeferredError(input.matchdayId, revision, "Scoring contention or changed inputs; durable work deferred.");
    }
    databaseFailure("Scoring transaction", response.error?.message ?? "No scoring result returned.");
  });
}
