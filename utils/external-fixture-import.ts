import {
  fetchCompetitionMatches,
  normalizeFootballDataMatch,
  type NormalizedFootballDataFixture,
} from "@/utils/football-data/client";
import { getActiveSeason } from "@/utils/seasons";
import { createAdminClient } from "@/utils/supabase/admin";

type AdminSupabaseClient = ReturnType<typeof createAdminClient>;

export type ExternalFixtureImportSeason = {
  id: string;
  name: string;
  status: string | null;
  base_provider: string | null;
  base_competition_code: string | null;
  provider_season: string | null;
  fixture_import_enabled: boolean | null;
};

type ExistingExternalFixtureMatchdayRow = {
  external_fixture_id: string;
  external_matchday: number | null;
};

export function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function validateDateWindow(dateFrom: string, dateTo: string) {
  if (!isDateOnly(dateFrom) || !isDateOnly(dateTo)) {
    return "date_from and date_to must use YYYY-MM-DD.";
  }

  if (dateFrom > dateTo) {
    return "date_from must be before or equal to date_to.";
  }

  return null;
}

function toUpsertRow(fixture: NormalizedFootballDataFixture, syncedAt: string) {
  return {
    ...fixture,
    last_synced_at: syncedAt,
    updated_at: syncedAt,
  };
}

async function getExistingExternalMatchdays({
  supabase,
  provider,
  externalFixtureIds,
}: {
  supabase: AdminSupabaseClient;
  provider: string;
  externalFixtureIds: string[];
}) {
  if (externalFixtureIds.length === 0) {
    return new Map<string, number>();
  }

  const { data, error } = await supabase
    .from("external_fixtures")
    .select("external_fixture_id, external_matchday")
    .eq("provider", provider)
    .in("external_fixture_id", externalFixtureIds);

  if (error) {
    throw new Error(error.message);
  }

  return new Map(
    ((data as ExistingExternalFixtureMatchdayRow[] | null) ?? [])
      .filter((row) => row.external_matchday !== null)
      .map((row) => [row.external_fixture_id, row.external_matchday!]),
  );
}

export async function loadExternalFixtureImportSeason({
  supabase,
  seasonId,
}: {
  supabase: AdminSupabaseClient;
  seasonId: string | null;
}) {
  const resolvedSeasonId =
    seasonId ??
    (await getActiveSeason(supabase, "id")).data?.id ??
    null;

  if (!resolvedSeasonId) {
    return {
      season: null,
      error: "No season_id provided and no active season found.",
    };
  }

  const { data: season, error } = await supabase
    .from("seasons")
    .select(
      "id, name, status, base_provider, base_competition_code, provider_season, fixture_import_enabled",
    )
    .eq("id", resolvedSeasonId)
    .single();

  if (error || !season) {
    return {
      season: null,
      error: error?.message ?? "Season not found.",
    };
  }

  return {
    season: season as ExternalFixtureImportSeason,
    error: null,
  };
}

export async function importExternalFixturesForSeason({
  supabase,
  season,
  competitionCode,
  dateFrom,
  dateTo,
  dryRun,
  syncedAt = new Date().toISOString(),
}: {
  supabase: AdminSupabaseClient;
  season: ExternalFixtureImportSeason;
  competitionCode: string;
  dateFrom: string;
  dateTo: string;
  dryRun: boolean;
  syncedAt?: string;
}) {
  const { matches, request: providerRequest } = await fetchCompetitionMatches({
    competitionCode,
    dateFrom,
    dateTo,
    season:
      competitionCode === season.base_competition_code
        ? season.provider_season ?? undefined
        : undefined,
  });
  const fixtureMatches = matches as Record<string, unknown>[];
  const fixtures = fixtureMatches.map((match) =>
    normalizeFootballDataMatch(match, competitionCode),
  );

  if (dryRun) {
    return {
      dry_run: true,
      season: {
        id: season.id,
        name: season.name,
        status: season.status,
        base_provider: season.base_provider,
        base_competition_code: season.base_competition_code,
        provider_season: season.provider_season,
        fixture_import_enabled: season.fixture_import_enabled,
      },
      competition_code: competitionCode,
      window: { date_from: dateFrom, date_to: dateTo },
      provider_request: providerRequest,
      provider_calls_made: 1,
      fetched_count: fixtures.length,
      planned_updates: fixtures.slice(0, 10),
      skipped: [],
      sample: fixtures.slice(0, 10),
    };
  }

  const existingMatchdays = await getExistingExternalMatchdays({
    supabase,
    provider: "football_data",
    externalFixtureIds: fixtures.map((fixture) => fixture.external_fixture_id),
  });
  const rows = fixtures.map((fixture) => ({
    ...toUpsertRow(fixture, syncedAt),
    external_matchday:
      fixture.external_matchday ??
      existingMatchdays.get(fixture.external_fixture_id) ??
      null,
  }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from("external_fixtures")
      .upsert(rows, { onConflict: "provider,external_fixture_id" });

    if (error) {
      throw new Error(error.message);
    }
  }

  return {
    dry_run: false,
    season: {
      id: season.id,
      name: season.name,
      base_provider: season.base_provider,
      base_competition_code: season.base_competition_code,
    },
    competition_code: competitionCode,
    window: { date_from: dateFrom, date_to: dateTo },
    provider_request: providerRequest,
    provider_calls_made: 1,
    upserted_count: rows.length,
    last_synced_at: syncedAt,
  };
}
