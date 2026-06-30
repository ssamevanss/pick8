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
  maybeSingle(): Promise<ActiveSeasonResult>;
};

type SeasonSelect = {
  select(columns: string): SeasonQuery;
};

type SeasonClient = {
  from(table: "seasons"): SeasonSelect;
};

export async function getActiveSeason(supabase: unknown, select: string) {
  const seasons = (supabase as SeasonClient).from("seasons");
  const activeByStatus = await seasons
    .select(select)
    .eq("status", "active")
    .maybeSingle();

  if (activeByStatus.data || activeByStatus.error) {
    return activeByStatus;
  }

  return seasons
    .select(select)
    .eq("is_active", true)
    .maybeSingle();
}
