"use server";

import { getRequestAuthContext } from "@/utils/app-context";
import {
  recalculateMatchdayScores,
  type ScoreRecalculationSummary,
} from "@/utils/pick8-scoring";

export type ScoreActionState = {
  ok: boolean;
  message: string;
  summary?: ScoreRecalculationSummary;
};

export async function recalculateScoresAction(
  _previousState: ScoreActionState,
  formData: FormData,
): Promise<ScoreActionState> {
  const { user, profile } = await getRequestAuthContext();
  if (!user || !profile?.is_active || !profile.is_admin) {
    return { ok: false, message: "Active administrator access is required." };
  }
  const seasonId = String(formData.get("season_id") ?? "").trim();
  const matchdayId = String(formData.get("matchday_id") ?? "").trim();
  if (!seasonId || !matchdayId) {
    return { ok: false, message: "Choose a season and matchday." };
  }
  try {
    const summary = await recalculateMatchdayScores({ seasonId, matchdayId });
    return {
      ok: true,
      message: `Matchday ${summary.matchdayNumber} scores recalculated.`,
      summary,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Score recalculation failed.",
    };
  }
}
