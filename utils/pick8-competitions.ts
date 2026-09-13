import "server-only";

import { createSyncDiagnostics } from "@/utils/pick8-sync-diagnostics";
import { competitionRefreshRequired } from "@/utils/pick8-sync-state";

import { createAdminClient } from "@/utils/supabase/admin";

const COMPETITION_RANGES = [
  [1, 5], [6, 10], [11, 15], [16, 20],
  [21, 25], [26, 30], [31, 35], [36, 38],
] as const;

type CompetitionStatus = "upcoming" | "active" | "completed";

export type CompetitionRefreshSummary = {
  season: string;
  inserted: number;
  statusesUpdated: number;
  activeCompetition: string | null;
  refreshedAt: string;
  skipped?: boolean;
};

function relevantMatchday(rows: Array<{ matchday_number: number; status: string; locks_at: string | null }>, now: number) {
  const first = (status: string) => rows.find((row) => row.status === status);
  return first("open") ?? first("scoring") ?? first("locked") ?? rows.find((row) => row.status === "upcoming" && row.locks_at !== null && Date.parse(row.locks_at) > now) ?? [...rows].reverse().find((row) => row.status === "completed") ?? null;
}

/** Creates missing fixed ranges and reconciles statuses for one Pick8 season. */
export async function refreshPick8Competitions(seasonId: string, options: { ifNeeded?: boolean } = {}): Promise<CompetitionRefreshSummary> {
  const diagnostics = createSyncDiagnostics({ operation: "refresh-competitions", seasonId });
  return diagnostics.stage("competition_refresh", async () => {
    try {
      return await refreshCompetitionsInternal(seasonId, options);
    } catch (error) {
      const { error: recoveryError } = await createAdminClient().from("seasons")
        .update({ competition_refresh_pending: true }).eq("id", seasonId);
      if (recoveryError) console.error("Could not retain competition recovery state", recoveryError.message);
      throw error;
    }
  });
}

async function refreshCompetitionsInternal(seasonId: string, options: { ifNeeded?: boolean }): Promise<CompetitionRefreshSummary> {
  const supabase = createAdminClient();
  const refreshedAt = new Date().toISOString();
  const { data: season, error: seasonError } = await supabase.from("seasons")
    .select("id, name, provider_season, competition_refresh_pending, competition_revision, competition_refresh_after")
    .eq("id", seasonId).single();
  if (seasonError || !season) throw new Error(`Loading competition season failed: ${seasonError?.message ?? "Season not found."}`);
  if (options.ifNeeded && !competitionRefreshRequired(season)) {
    return { season: season.name, inserted: 0, statusesUpdated: 0, activeCompetition: null, refreshedAt, skipped: true };
  }
  const { error: pendingError } = await supabase.from("seasons").update({ competition_refresh_pending: true }).eq("id", seasonId);
  if (pendingError) throw new Error(`Marking competition refresh pending failed: ${pendingError.message}`);
  const [{ data: existingRows, error: competitionError }, { data: matchdayRows, error: matchdayError }] = await Promise.all([
    supabase.from("competitions").select("id, name, start_matchday, end_matchday, status").eq("season_id", seasonId).order("start_matchday"),
    supabase.from("matchdays").select("matchday_number, status, locks_at").eq("season_id", seasonId).order("matchday_number"),
  ]);
  if (competitionError) throw new Error(`Loading competitions failed: ${competitionError.message}`);
  if (matchdayError) throw new Error(`Loading competition matchdays failed: ${matchdayError.message}`);

  const existing = existingRows ?? [];
  const missing = COMPETITION_RANGES.flatMap(([start, end], index) => existing.some((row) => row.start_matchday === start && row.end_matchday === end) ? [] : [{ season_id: seasonId, name: `Competition ${index + 1} · Matchdays ${start}–${end}`, start_matchday: start, end_matchday: end, status: "upcoming" as const }]);
  let inserted = missing.length;
  if (missing.length) {
    const { error } = await supabase.from("competitions").insert(missing);
    if (error) {
      // Another serialized generator may have created the ranges first.
      const { data: afterRace, error: reloadError } = await supabase.from("competitions").select("start_matchday, end_matchday").eq("season_id", seasonId);
      const complete = !reloadError && COMPETITION_RANGES.every(([start, end]) => afterRace?.some((row) => row.start_matchday === start && row.end_matchday === end));
      if (!complete) throw new Error(`Creating competitions failed: ${error.message}`);
      inserted = 0;
    }
  }

  const { data: competitions, error: reloadError } = await supabase.from("competitions").select("id, name, start_matchday, end_matchday, status").eq("season_id", seasonId).order("start_matchday");
  if (reloadError) throw new Error(`Reloading competitions failed: ${reloadError.message}`);
  const matchdays = matchdayRows ?? [];
  const evaluatedAt = Date.now();
  const current = relevantMatchday(matchdays, evaluatedAt);
  let statusesUpdated = 0;
  let activeCompetition: string | null = null;
  for (const competition of competitions ?? []) {
    const expected = competition.end_matchday - competition.start_matchday + 1;
    const inRange = matchdays.filter((row) => row.matchday_number >= competition.start_matchday && row.matchday_number <= competition.end_matchday);
    const completed = inRange.length === expected && inRange.every((row) => row.status === "completed");
    const containsCurrent = Boolean(current && current.matchday_number >= competition.start_matchday && current.matchday_number <= competition.end_matchday);
    const status: CompetitionStatus = containsCurrent ? "active" : completed ? "completed" : "upcoming";
    if (status === "active") activeCompetition = competition.name;
    if (competition.status !== status) {
      const { error } = await supabase.from("competitions").update({ status, updated_at: refreshedAt }).eq("id", competition.id);
      if (error) throw new Error(`Updating competition status failed: ${error.message}`);
      statusesUpdated += 1;
    }
  }
  const nextBoundary = matchdays.filter((row) => row.status === "upcoming" && row.locks_at && Date.parse(row.locks_at) > evaluatedAt)
    .map((row) => row.locks_at!).sort()[0] ?? null;
  const { data: acknowledged, error: acknowledgementError } = await supabase.from("seasons")
    .update({ competition_refresh_pending: false, competition_refresh_after: nextBoundary })
    .eq("id", seasonId).eq("competition_revision", season.competition_revision)
    .select("id").maybeSingle();
  if (acknowledgementError) throw new Error(`Acknowledging competition refresh failed: ${acknowledgementError.message}`);
  if (!acknowledged) throw new Error("Competition inputs changed during refresh; retry required.");
  return { season: season.name, inserted, statusesUpdated, activeCompetition, refreshedAt };
}
