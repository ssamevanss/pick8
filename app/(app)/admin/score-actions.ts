"use server";

import { revalidatePath } from "next/cache";
import { getRequestAuthContext } from "@/utils/app-context";
import {
  recalculateMatchdayScores,
  type ScoreRecalculationSummary,
} from "@/utils/pick8-scoring";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  MATCHDAY_2_FINAL_SCORE_PLAN,
  MATCHDAY_2_TEST_ENTRY_ID,
  MATCHDAY_2_TEST_ID,
  manualTestFinalGoalTotal,
} from "@/utils/pick8-manual-test";

type ManualMatchday3RpcResult = {
  matchday_id?: unknown;
  season_id?: unknown;
  created?: unknown;
  fixture_count?: unknown;
  locks_at?: unknown;
};

function manualMatchday3Result(value: unknown): ManualMatchday3RpcResult {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ManualMatchday3RpcResult
    : {};
}

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

export async function createManualMatchday3Test(
  _previousState: ScoreActionState,
  _formData: FormData,
): Promise<ScoreActionState> {
  void _previousState;
  void _formData;
  const { user, profile } = await getRequestAuthContext();
  if (!user || !profile?.is_active || !profile.is_admin) {
    return { ok: false, message: "Active administrator access is required." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_pick8_manual_test_matchday3");
  if (error) return { ok: false, message: error.message };
  const result = manualMatchday3Result(data);
  if (typeof result.matchday_id !== "string" || result.fixture_count !== 10) {
    return { ok: false, message: "Manual Matchday 3 creation returned an invalid result." };
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/my-picks");
  return {
    ok: true,
    message: result.created
      ? "Manual Matchday 3 created with ten synthetic fixtures."
      : "Manual Matchday 3 already exists with the expected fixture set; no changes were made.",
  };
}

export async function finalizeManualMatchday3Test(
  _previousState: ScoreActionState,
  formData: FormData,
): Promise<ScoreActionState> {
  const { user, profile } = await getRequestAuthContext();
  if (!user || !profile?.is_active || !profile.is_admin) {
    return { ok: false, message: "Active administrator access is required." };
  }
  if (formData.get("confirm_matchday3_final_scores") !== "on") {
    return { ok: false, message: "Confirm the Matchday 3 fake final scores before continuing." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("finish_pick8_manual_test_matchday3");
  if (error) return { ok: false, message: error.message };
  const result = manualMatchday3Result(data);
  if (
    typeof result.matchday_id !== "string" ||
    typeof result.season_id !== "string" ||
    result.fixture_count !== 10
  ) {
    return { ok: false, message: "Manual Matchday 3 finalisation returned an invalid result." };
  }

  try {
    const summary = await recalculateMatchdayScores({
      seasonId: result.season_id,
      matchdayId: result.matchday_id,
    });
    revalidatePath("/admin");
    revalidatePath("/dashboard");
    revalidatePath("/my-picks");
    revalidatePath("/tables");
    return {
      ok: true,
      message: "Manual Matchday 3 finalized through the normal scoring path.",
      summary,
    };
  } catch (scoringError) {
    return {
      ok: false,
      message: scoringError instanceof Error
        ? scoringError.message
        : "Normal Matchday 3 scoring failed.",
    };
  }
}

export async function finalizeManualMatchday2Test(
  _previousState: ScoreActionState,
  formData: FormData,
): Promise<ScoreActionState> {
  const { user, profile } = await getRequestAuthContext();
  if (!user || !profile?.is_active || !profile.is_admin) {
    return { ok: false, message: "Active administrator access is required." };
  }
  if (formData.get("confirm_final_scores") !== "on") {
    return { ok: false, message: "Confirm the ten fake final scores before continuing." };
  }

  const admin = createAdminClient();
  const { data: matchday, error: matchdayError } = await admin
    .from("matchdays")
    .select("id, season_id, matchday_number, fixture_sync_mode")
    .eq("id", MATCHDAY_2_TEST_ID)
    .maybeSingle();
  if (matchdayError || !matchday || matchday.matchday_number !== 2 || matchday.fixture_sync_mode !== "manual") {
    return { ok: false, message: "The audited Matchday 2 is missing or is not manually managed." };
  }

  const [{ data: fixtures, error: fixturesError }, { data: entry, error: entryError }] = await Promise.all([
    admin.from("fixtures").select("id, external_fixture_id").eq("matchday_id", matchday.id),
    admin.from("entries").select("id, submitted_at, total_goals_prediction").eq("id", MATCHDAY_2_TEST_ENTRY_ID).eq("matchday_id", matchday.id).maybeSingle(),
  ]);
  if (fixturesError || entryError) return { ok: false, message: "The manual test state could not be verified." };
  const expectedIds = MATCHDAY_2_FINAL_SCORE_PLAN.map((fixture) => fixture.externalFixtureId).sort();
  const actualIds = (fixtures ?? []).map((fixture) => fixture.external_fixture_id).sort();
  if (actualIds.length !== 10 || actualIds.some((id, index) => id !== expectedIds[index])) {
    return { ok: false, message: "Matchday 2 must contain exactly the ten audited synthetic fixtures before finalisation." };
  }
  if (!entry?.submitted_at || entry.total_goals_prediction !== 25) {
    return { ok: false, message: "The submitted Matchday 2 test entry or Total Goals 25 prediction is missing." };
  }
  const { count: selectionCount, error: selectionError } = await admin
    .from("entry_selections")
    .select("id", { count: "exact", head: true })
    .eq("entry_id", entry.id);
  if (selectionError || selectionCount !== 7) {
    return { ok: false, message: "The submitted test entry no longer has exactly seven selections." };
  }

  const updatedAt = new Date().toISOString();
  for (const planned of MATCHDAY_2_FINAL_SCORE_PLAN) {
    const { error } = await admin
      .from("fixtures")
      .update({
        status: "finished",
        home_score: planned.homeScore,
        away_score: planned.awayScore,
        updated_at: updatedAt,
      })
      .eq("matchday_id", matchday.id)
      .eq("external_fixture_id", planned.externalFixtureId);
    if (error) return { ok: false, message: `Setting final score for ${planned.externalFixtureId} failed.` };
  }

  try {
    const summary = await recalculateMatchdayScores({
      seasonId: matchday.season_id,
      matchdayId: matchday.id,
    });
    revalidatePath("/admin");
    revalidatePath("/dashboard");
    revalidatePath("/my-picks");
    revalidatePath("/tables");
    return {
      ok: true,
      message: `Matchday 2 finalized through normal scoring with ${manualTestFinalGoalTotal()} actual goals.`,
      summary,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Normal Matchday 2 scoring failed." };
  }
}
