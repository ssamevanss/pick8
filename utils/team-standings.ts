import {
  fetchCompetitionStandings,
  FootballDataError,
  getFootballDataSeasonQueryValue,
} from "@/utils/football-data/client";
import { createAdminClient } from "@/utils/supabase/admin";
import { stripRawPayload } from "@/utils/cron-diagnostics";

type AdminSupabaseClient = ReturnType<typeof createAdminClient>;
type JsonRecord = Record<string, unknown>;

export { FootballDataError };

export type StandingsRefreshSeason = {
  id: string;
  league_id: string;
  name: string;
  status: string | null;
  base_provider: string | null;
  base_competition_code: string | null;
  provider_season: string | null;
  fixture_import_enabled: boolean | null;
};

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function getEligibleActiveStandingsSeason({
  supabase,
  seasonId,
}: {
  supabase: AdminSupabaseClient;
  seasonId: string;
}) {
  const { data: activeSeason, error } = await supabase
    .from("seasons")
    .select("id, league_id, name, status, base_provider, base_competition_code, provider_season, fixture_import_enabled, leagues!inner(status)")
    .eq("id", seasonId)
    .eq("status", "active")
    .eq("leagues.status", "active")
    .maybeSingle();
  const season = activeSeason as StandingsRefreshSeason | null;

  if (
    !season ||
    season.status !== "active" ||
    season.base_provider !== "football_data" ||
    !season.base_competition_code
  ) {
    return { season: null, error };
  }

  return { season, error };
}

export async function getEligibleActiveStandingsSeasons({
  supabase,
}: {
  supabase: AdminSupabaseClient;
}) {
  const { data, error } = await supabase
    .from("seasons")
    .select(
      "id, league_id, name, status, base_provider, base_competition_code, provider_season, fixture_import_enabled, leagues!inner(status)",
    )
    .eq("status", "active")
    .eq("base_provider", "football_data")
    .eq("leagues.status", "active")
    .order("created_at", { ascending: true });

  return {
    seasons: ((data as StandingsRefreshSeason[] | null) ?? []).filter(
      (season) => Boolean(season.base_competition_code),
    ),
    error,
  };
}

export async function refreshTeamStandings({
  supabase,
  season,
  competitionCode,
  dryRun,
}: {
  supabase: AdminSupabaseClient;
  season: StandingsRefreshSeason;
  competitionCode: string;
  dryRun: boolean;
}) {
  const syncedAt = new Date().toISOString();
  const { data, request } = await fetchCompetitionStandings({
    competitionCode,
    season:
      competitionCode === season.base_competition_code
        ? getFootballDataSeasonQueryValue(season.provider_season)
        : undefined,
  });
  const standings = Array.isArray(data?.standings)
    ? data.standings.map(asRecord).filter((item): item is JsonRecord => Boolean(item))
    : [];
  const totalStanding = standings.find(
    (standing) => asString(standing.type) === "TOTAL",
  );
  const table = Array.isArray(totalStanding?.table)
    ? totalStanding.table.map(asRecord).filter((item): item is JsonRecord => Boolean(item))
    : [];
  const rows = table.flatMap((standingRow) => {
    const team = asRecord(standingRow.team);
    const teamId = team?.id === undefined || team?.id === null ? null : String(team.id);
    const teamName = asString(team?.name) ?? asString(team?.shortName);
    const position = asNumber(standingRow.position);

    if (!teamId || !teamName || position === null) {
      return [];
    }

    return {
      provider: "football_data",
      external_competition_code: competitionCode,
      provider_season: season.provider_season ?? "",
      external_team_id: teamId,
      team_name: teamName,
      team_short_name: asString(team?.shortName),
      team_tla: asString(team?.tla),
      crest_url: asString(team?.crest),
      position,
      played: asNumber(standingRow.playedGames),
      won: asNumber(standingRow.won),
      drawn: asNumber(standingRow.draw),
      lost: asNumber(standingRow.lost),
      points: asNumber(standingRow.points),
      raw_payload: standingRow,
      updated_at: syncedAt,
    };
  });

  if (!dryRun && rows.length > 0) {
    const { error } = await supabase
      .from("external_team_standings")
      .upsert(rows, {
        onConflict:
          "provider,external_competition_code,provider_season,external_team_id",
      });

    if (error) {
      throw new Error(error.message);
    }
  }

  return {
    dry_run: dryRun,
    season: {
      id: season.id,
      name: season.name,
      base_competition_code: season.base_competition_code,
      provider_season: season.provider_season,
    },
    competition_code: competitionCode,
    provider_request: request,
    provider_calls_made: 1,
    fetched_count: rows.length,
    upserted_count: dryRun ? 0 : rows.length,
    skipped_reason: rows.length === 0 ? "provider returned no total standings rows" : null,
    planned_updates: rows.slice(0, 5).map(stripRawPayload),
    last_synced_at: dryRun ? null : syncedAt,
  };
}
