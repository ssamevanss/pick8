"use server";

import { getRequestAuthContext } from "@/utils/app-context";
import { refreshPick8Competitions, type CompetitionRefreshSummary } from "@/utils/pick8-competitions";

export type CompetitionActionState = { ok: boolean; message: string; summary?: CompetitionRefreshSummary };

export async function refreshCompetitionsAction(
  _previousState: CompetitionActionState,
  _formData: FormData,
): Promise<CompetitionActionState> {
  void _previousState;
  void _formData;
  const { supabase, user, profile } = await getRequestAuthContext();
  if (!user || !profile?.is_admin || !profile.is_active) return { ok: false, message: "Active administrator access is required." };
  const { data: season, error } = await supabase.from("seasons").select("id").eq("is_active", true).maybeSingle();
  if (error || !season) return { ok: false, message: "No active season is available." };
  try {
    const summary = await refreshPick8Competitions(season.id);
    return { ok: true, message: "Competitions refreshed.", summary };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Competition refresh failed unexpectedly." };
  }
}
