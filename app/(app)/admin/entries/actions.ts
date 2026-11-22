"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getRequestAuthContext } from "@/utils/app-context";
import { createInteractiveAdminClient } from "@/utils/supabase/admin";
import { parsePick8DraftSelections, isCompletePick8Entry } from "@/utils/pick8-entry-validation";
import { normalizePick8RulesVersion } from "@/utils/pick8-rules";
import { recalculateMatchdayScores } from "@/utils/pick8-scoring";
import type { PickEntryActionState } from "@/app/(app)/my-picks/actions";

export async function saveAdminPickEntry(_previous: PickEntryActionState, form: FormData): Promise<PickEntryActionState> {
  const { user, profile, requestDeadlineSignal } = await getRequestAuthContext();
  if (!user || !profile?.is_admin || !profile.is_active) return { ok: false, message: "Active administrator access is required." };
  if (form.get("confirm_admin_save") !== "on") return { ok: false, message: "Confirm that you have checked the player and picks before saving." };
  const admin = createInteractiveAdminClient({ overallSignal: requestDeadlineSignal, context: { action: "admin.save-entry" } });
  const matchdayId = String(form.get("matchday_id") ?? "");
  const playerId = String(form.get("player_id") ?? "");
  const reason = String(form.get("admin_reason") ?? "").trim();
  const intent = String(form.get("intent") ?? "");
  if (!["draft", "submit", "save_changes"].includes(intent) || reason.length < 5 || reason.length > 1000) return { ok: false, message: "Choose a valid action and provide a reason (5–1000 characters)." };
  const [{ data: md, error: mdError }, { data: fixtures, error: fixtureError }] = await Promise.all([
    admin.from("matchdays").select("season_id,pick8_rules_version").eq("id", matchdayId).maybeSingle(),
    admin.from("fixtures").select("id").eq("matchday_id", matchdayId),
  ]);
  if (mdError || fixtureError || !md || !fixtures) return { ok: false, message: "Matchday could not be verified." };
  const version = normalizePick8RulesVersion(md.pick8_rules_version);
  const parsed = parsePick8DraftSelections(form, fixtures.map(f => f.id), version);
  if ("error" in parsed) return { ok: false, message: parsed.error ?? "Invalid selections." };
  const rawGoals = String(form.get("total_goals") ?? "").trim();
  const goals = rawGoals === "" ? null : Number(rawGoals);
  if ((goals !== null && (!Number.isInteger(goals) || goals < 0 || goals > 100)) ||
      (intent !== "draft" && !isCompletePick8Entry(parsed.selections, goals, version))) return { ok: false, message: "Complete every category on distinct fixtures and enter Total Goals (0–100)." };
  const { data, error } = await admin.rpc("admin_save_pick8_entry", {
    check_actor_id: user.id, check_player_id: playerId, check_matchday_id: matchdayId,
    check_expected_updated_at: String(form.get("expected_updated_at") ?? "") || null,
    check_reason: reason, check_allow_post_lock: form.get("allow_post_lock") === "on",
    check_intent: intent, check_total_goals: goals,
    check_selections: parsed.selections.map(s => ({ category: s.category, fixture_id: s.fixtureId, selected_team_side: s.selectedTeamSide })),
  }).retry(false);
  if (error?.code === "42501") return { ok: false, message: "Confirm the authorised post-deadline change. The administrator and player must both still be active." };
  if (["23514", "22023"].includes(error?.code ?? "")) return { ok: false, message: "The entry could not be validated. Check the reason, all selections and Total Goals, then try again." };
  if (error || !data) return { ok: false, outcome: "unknown", message: "Save was not confirmed. Reload the entry before retrying. Check that it has not changed, and confirm any authorised post-deadline change." };
  let scoringPending = false;
  if (intent !== "draft") {
    try { await recalculateMatchdayScores({ seasonId: md.season_id, matchdayId }); }
    catch { scoringPending = true; }
  }
  for (const path of ["/admin", "/admin/entries", "/my-picks", "/dashboard", "/tables"]) revalidatePath(path);
  redirect(`/admin/entries?player=${encodeURIComponent(playerId)}&matchday=${encodeURIComponent(matchdayId)}&saved=${scoringPending ? "pending" : "1"}`);
}
