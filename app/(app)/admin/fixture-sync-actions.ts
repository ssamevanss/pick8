"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getRequestAuthContext } from "@/utils/app-context";
import {
  FixtureSyncError,
  syncWhoYouGotFixtures,
  type FixtureSyncSummary,
} from "@/utils/who-you-got-fixture-sync";
import { createAdminClient } from "@/utils/supabase/admin";
import { refreshPick8Competitions } from "@/utils/pick8-competitions";
import { isFixtureSyncMode } from "@/utils/pick8-fixture-sync-mode";

export type FixtureSyncActionState = {
  ok: boolean;
  message: string;
  summary?: FixtureSyncSummary;
};

export async function syncFixturesAction(
  _previousState: FixtureSyncActionState,
  formData: FormData,
): Promise<FixtureSyncActionState> {
  const { user, profile } = await getRequestAuthContext();
  if (!user || !profile?.is_admin || !profile.is_active) {
    return { ok: false, message: "Active administrator access is required." };
  }

  const season = Number(String(formData.get("season") ?? "").trim());
  const matchday = Number(String(formData.get("matchday") ?? "").trim());
  try {
    const summary = await syncWhoYouGotFixtures({ season, matchday });
    const admin = createAdminClient();
    const { data: syncedSeason, error: seasonError } = await admin.from("seasons").select("id").eq("provider_season", summary.season).single();
    if (seasonError || !syncedSeason) throw new Error("The synced season could not be loaded for competition refresh.");
    await refreshPick8Competitions(syncedSeason.id);
    return {
      ok: true,
      message: `Season ${summary.season}/${String((summary.season + 1) % 100).padStart(2, "0")} matchday ${summary.matchday} synced.`,
      summary,
    };
  } catch (error) {
    if (error instanceof FixtureSyncError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "Fixture sync failed unexpectedly." };
  }
}

export async function updateMatchdayFixtureSyncMode(formData: FormData) {
  const { supabase, user, profile } = await getRequestAuthContext();
  if (!user || !profile?.is_admin || !profile.is_active) {
    redirect("/dashboard?error=Admin+access+required");
  }
  const matchdayId = String(formData.get("matchday_id") ?? "").trim();
  const mode = String(formData.get("fixture_sync_mode") ?? "").trim();
  if (!matchdayId || !isFixtureSyncMode(mode)) {
    redirect("/admin?error=Invalid+fixture+sync+mode");
  }
  const { error } = await supabase
    .from("matchdays")
    .update({ fixture_sync_mode: mode, updated_at: new Date().toISOString() })
    .eq("id", matchdayId);
  if (error) redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/admin");
  redirect("/admin?saved=fixture-mode");
}
