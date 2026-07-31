type ActiveSeasonRow = {
  id: string;
  name?: string;
  status?: "draft" | "active" | "archived";
  show_in_archive?: boolean;
  archived_at?: string | null;
  is_active?: boolean;
};

type ActiveSeasonResult = {
  data: ActiveSeasonRow | null;
  error: unknown;
};

type SeasonQuery = {
  eq(column: string, value: string | boolean): SeasonQuery;
  neq(column: string, value: string | boolean): SeasonQuery;
  maybeSingle(): Promise<ActiveSeasonResult>;
};

type SeasonSelect = {
  select(columns: string): SeasonQuery;
};

type SeasonClient = {
  from(table: "seasons"): SeasonSelect;
};

export async function getActiveSeason(
  supabase: unknown,
  select: string,
  leagueId: string,
) {
  const seasons = (supabase as SeasonClient).from("seasons");
  let activeByStatusQuery = seasons.select(select).eq("status", "active");

  activeByStatusQuery = activeByStatusQuery.eq("league_id", leagueId);

  const activeByStatus = await activeByStatusQuery.maybeSingle();

  if (activeByStatus.data || activeByStatus.error) {
    return activeByStatus;
  }

  let activeByLegacyFlagQuery = seasons.select(select).eq("is_active", true);

  activeByLegacyFlagQuery = activeByLegacyFlagQuery.neq("status", "archived");

  activeByLegacyFlagQuery = activeByLegacyFlagQuery.eq(
    "league_id",
    leagueId,
  );

  return activeByLegacyFlagQuery.maybeSingle();
}
