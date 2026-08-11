"use server";

import { revalidatePath } from "next/cache";
import { getRequestAuthContext } from "@/utils/app-context";
import {
  recalculateMatchdayScores,
  type ScoreRecalculationSummary,
} from "@/utils/pick8-scoring";
import { createAdminClient } from "@/utils/supabase/admin";
import { refreshPick8Competitions } from "@/utils/pick8-competitions";
import {
  MATCHDAY_2_FINAL_SCORE_PLAN,
  MATCHDAY_2_TEST_ENTRY_ID,
  MATCHDAY_2_TEST_ID,
  canUseAcceleratedTestCompletion,
  manualTestFinalGoalTotal,
} from "@/utils/pick8-manual-test";

type ManualMatchdayRpcResult = {
  matchday_id?: unknown;
  season_id?: unknown;
  matchday_number?: unknown;
  created?: unknown;
  fixture_count?: unknown;
  locks_at?: unknown;
};

function manualMatchdayResult(value: unknown): ManualMatchdayRpcResult {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ManualMatchdayRpcResult
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

export async function createManualMatchdayTest(
  _previousState: ScoreActionState,
  formData: FormData,
): Promise<ScoreActionState> {
  void _previousState;
  const { user, profile } = await getRequestAuthContext();
  if (!user || !profile?.is_active || !profile.is_admin) {
    return { ok: false, message: "Active administrator access is required." };
  }

  const matchdayNumber = Number(formData.get("test_matchday_number"));
  if (!Number.isInteger(matchdayNumber) || matchdayNumber < 3 || matchdayNumber > 99) {
    return { ok: false, message: "Choose a valid accelerated test matchday." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_pick8_accelerated_test_matchday", {
    target_matchday_number: matchdayNumber,
  });
  if (error) return { ok: false, message: error.message };
  const result = manualMatchdayResult(data);
  if (typeof result.matchday_id !== "string" || result.fixture_count !== 10 || result.matchday_number !== matchdayNumber) {
    return { ok: false, message: `Manual Matchday ${matchdayNumber} creation returned an invalid result.` };
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/my-picks");
  return {
    ok: true,
    message: result.created
      ? `Manual Matchday ${matchdayNumber} created with ten synthetic fixtures.`
      : `Manual Matchday ${matchdayNumber} already exists with the expected fixture set; no changes were made.`,
  };
}

export async function finalizeManualMatchdayTest(
  _previousState: ScoreActionState,
  formData: FormData,
): Promise<ScoreActionState> {
  const { user, profile } = await getRequestAuthContext();
  if (!user || !profile?.is_active || !profile.is_admin) {
    return { ok: false, message: "Active administrator access is required." };
  }
  const matchdayNumber = Number(formData.get("test_matchday_number"));
  if (!Number.isInteger(matchdayNumber) || matchdayNumber < 3 || matchdayNumber > 99) {
    return { ok: false, message: "Choose a valid accelerated test matchday." };
  }
  const confirmed = formData.get("confirm_accelerated_final_scores") === "on";
  if (!confirmed) {
    return { ok: false, message: `Confirm the Matchday ${matchdayNumber} fake final scores before continuing.` };
  }

  const admin = createAdminClient();
  const { data: testMatchday, error: testMatchdayError } = await admin
    .from("matchdays")
    .select("id, matchday_number, fixture_sync_mode, is_accelerated_test, seasons!inner(is_active)")
    .eq("matchday_number", matchdayNumber)
    .eq("seasons.is_active", true)
    .maybeSingle();
  if (testMatchdayError || !testMatchday) {
    return { ok: false, message: `Manual Matchday ${matchdayNumber} could not be verified.` };
  }
  const { data: testFixtures, error: testFixturesError } = await admin
    .from("fixtures")
    .select("external_fixture_id")
    .eq("matchday_id", testMatchday.id);
  if (
    testFixturesError ||
    !canUseAcceleratedTestCompletion({
      isAuthorizedAdmin: true,
      confirmed,
      fixtureSyncMode: testMatchday.fixture_sync_mode,
      isAcceleratedTest: testMatchday.is_accelerated_test,
      matchdayNumber,
      fixtureIds: (testFixtures ?? []).map((fixture) => fixture.external_fixture_id),
    })
  ) {
    return { ok: false, message: "Accelerated completion is restricted to the exact synthetic fixture set created by this manual-test tool." };
  }
  const { data, error } = await admin.rpc("prepare_pick8_accelerated_test_completion", {
    target_matchday_number: matchdayNumber,
    confirmed,
  });
  if (error) return { ok: false, message: error.message };
  const result = manualMatchdayResult(data);
  if (
    typeof result.matchday_id !== "string" ||
    typeof result.season_id !== "string" ||
    result.matchday_number !== matchdayNumber ||
    result.fixture_count !== 10
  ) {
    return { ok: false, message: `Manual Matchday ${matchdayNumber} finalisation returned an invalid result.` };
  }

  try {
    const summary = await recalculateMatchdayScores({
      seasonId: result.season_id,
      matchdayId: result.matchday_id,
      allowAcceleratedTestCompletion: true,
    });
    await refreshPick8Competitions(result.season_id);
    revalidatePath("/admin");
    revalidatePath("/dashboard");
    revalidatePath("/my-picks");
    revalidatePath("/tables");
    return {
      ok: true,
      message: `Manual Matchday ${matchdayNumber} finalized through the normal scoring path. The accelerated exception applied only to its synthetic kickoff times.`,
      summary,
    };
  } catch (scoringError) {
    return {
      ok: false,
      message: scoringError instanceof Error
        ? scoringError.message
        : `Normal Matchday ${matchdayNumber} scoring failed.`,
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
    .select("id, season_id, matchday_number, fixture_sync_mode, is_accelerated_test")
    .eq("id", MATCHDAY_2_TEST_ID)
    .maybeSingle();
  if (matchdayError || !matchday || matchday.matchday_number !== 2 || matchday.fixture_sync_mode !== "manual" || !matchday.is_accelerated_test) {
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
      allowAcceleratedTestCompletion: true,
    });
    await refreshPick8Competitions(matchday.season_id);
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
