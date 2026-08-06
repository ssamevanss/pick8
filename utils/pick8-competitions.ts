import "server-only";

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
};

function relevantMatchday(rows: Array<{ matchday_number: number; status: string; locks_at: string | null }>, now: number) {
  const first = (status: string) => rows.find((row) => row.status === status);
  return first("open") ?? first("scoring") ?? rows.find((row) => row.status === "upcoming" && row.locks_at !== null && Date.parse(row.locks_at) > now) ?? [...rows].reverse().find((row) => row.status === "completed") ?? null;
}

/** Creates missing fixed ranges and reconciles statuses for one Pick8 season. */
export async function refreshPick8Competitions(seasonId: string): Promise<CompetitionRefreshSummary> {
  const supabase = createAdminClient();
  const refreshedAt = new Date().toISOString();
  const [{ data: season, error: seasonError }, { data: existingRows, error: competitionError }, { data: matchdayRows, error: matchdayError }] = await Promise.all([
    supabase.from("seasons").select("id, name, provider_season").eq("id", seasonId).single(),
    supabase.from("competitions").select("id, name, start_matchday, end_matchday, status").eq("season_id", seasonId).order("start_matchday"),
    supabase.from("matchdays").select("matchday_number, status, locks_at").eq("season_id", seasonId).order("matchday_number"),
  ]);
  if (seasonError || !season) throw new Error(`Loading competition season failed: ${seasonError?.message ?? "Season not found."}`);
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
  const current = relevantMatchday(matchdays, Date.now());
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
  return { season: season.name, inserted, statusesUpdated, activeCompetition, refreshedAt };
}
