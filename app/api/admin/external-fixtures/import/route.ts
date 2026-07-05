import { NextRequest } from "next/server";
import {
  fetchCompetitionMatches,
  FootballDataError,
  normalizeFootballDataMatch,
  type NormalizedFootballDataFixture,
} from "@/utils/football-data/client";
import { getActiveSeason } from "@/utils/seasons";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

type ExternalFixtureImportSeason = {
  id: string;
  name: string;
  status: string | null;
  base_provider: string | null;
  base_competition_code: string | null;
  provider_season: string | null;
  fixture_import_enabled: boolean | null;
};

type ImportRequestParams = {
  seasonId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  dryRun: boolean;
};

type ExistingExternalFixtureMatchdayRow = {
  external_fixture_id: string;
  external_matchday: number | null;
};

async function requireAdmin() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { error: null };
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function parseImportRequest(request: NextRequest): Promise<ImportRequestParams> {
  const searchParams = request.nextUrl.searchParams;
  const bodyParams = new URLSearchParams();

  if (request.method !== "GET") {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

      if (body) {
        for (const [key, value] of Object.entries(body)) {
          if (value !== undefined && value !== null) {
            bodyParams.set(key, String(value));
          }
        }
      }
    } else {
      const formData = await request.formData().catch(() => null);

      if (formData) {
        for (const [key, value] of formData.entries()) {
          bodyParams.set(key, String(value));
        }
      }
    }
  }

  const readParam = (name: string) => bodyParams.get(name) ?? searchParams.get(name);
  const dryRunValue = readParam("dry_run");

  return {
    seasonId: readParam("season_id"),
    dateFrom: readParam("date_from"),
    dateTo: readParam("date_to"),
    dryRun: dryRunValue !== "0" && dryRunValue !== "false",
  };
}

function validateDateWindow(dateFrom: string, dateTo: string) {
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
  supabase: ReturnType<typeof createAdminClient>;
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

async function loadSeason(seasonId: string | null) {
  const adminSupabase = createAdminClient();
  const resolvedSeasonId =
    seasonId ??
    (await getActiveSeason(adminSupabase, "id")).data?.id ??
    null;

  if (!resolvedSeasonId) {
    return {
      adminSupabase,
      season: null,
      error: Response.json(
        { error: "No season_id provided and no active season found." },
        { status: 400 },
      ),
    };
  }

  const { data: season, error } = await adminSupabase
    .from("seasons")
    .select(
      "id, name, status, base_provider, base_competition_code, provider_season, fixture_import_enabled",
    )
    .eq("id", resolvedSeasonId)
    .single();

  if (error || !season) {
    return {
      adminSupabase,
      season: null,
      error: Response.json(
        { error: error?.message ?? "Season not found." },
        { status: 404 },
      ),
    };
  }

  return {
    adminSupabase,
    season: season as ExternalFixtureImportSeason,
    error: null,
  };
}

async function handleImport(request: NextRequest) {
  const { error: authError } = await requireAdmin();

  if (authError) {
    return authError;
  }

  let params: ImportRequestParams;

  try {
    params = await parseImportRequest(request);
  } catch {
    return Response.json({ error: "Could not parse import request." }, { status: 400 });
  }

  const now = new Date();
  const syncedAt = now.toISOString();
  const dateFrom = params.dateFrom ?? formatDateOnly(addDays(now, -2));
  const dateTo = params.dateTo ?? formatDateOnly(addDays(now, 45));
  const dateError = validateDateWindow(dateFrom, dateTo);

  if (dateError) {
    return Response.json({ error: dateError }, { status: 400 });
  }

  let loadedSeason: Awaited<ReturnType<typeof loadSeason>>;

  try {
    loadedSeason = await loadSeason(params.seasonId);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not create Supabase admin client.",
      },
      { status: 500 },
    );
  }

  if (loadedSeason.error || !loadedSeason.season) {
    return loadedSeason.error;
  }

  const { adminSupabase, season } = loadedSeason;

  if (season.base_provider !== "football_data") {
    return Response.json(
      { error: "Season base_provider must be football_data before importing fixtures." },
      { status: 400 },
    );
  }

  if (!season.base_competition_code) {
    return Response.json(
      { error: "Season base_competition_code is required before importing fixtures." },
      { status: 400 },
    );
  }

  if (!params.dryRun && !season.fixture_import_enabled) {
    return Response.json(
      {
        error:
          "Fixture import is disabled for this season. Set fixture_import_enabled=true before running a real import.",
      },
      { status: 403 },
    );
  }

  try {
    const { matches, request: providerRequest } = await fetchCompetitionMatches({
      competitionCode: season.base_competition_code,
      dateFrom,
      dateTo,
      season: season.provider_season ?? undefined,
    });
    const fixtureMatches = matches as Record<string, unknown>[];
    const fixtures = fixtureMatches.map((match) =>
      normalizeFootballDataMatch(match, season.base_competition_code ?? undefined),
    );

    if (params.dryRun) {
      return Response.json({
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
        window: { date_from: dateFrom, date_to: dateTo },
        provider_request: providerRequest,
        fetched_count: fixtures.length,
        sample: fixtures.slice(0, 10),
      });
    }

    const existingMatchdays = await getExistingExternalMatchdays({
      supabase: adminSupabase,
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
    if (rows.length === 0) {
      return Response.json({
        dry_run: false,
        season: {
          id: season.id,
          name: season.name,
          base_provider: season.base_provider,
          base_competition_code: season.base_competition_code,
        },
        window: { date_from: dateFrom, date_to: dateTo },
        provider_request: providerRequest,
        upserted_count: 0,
        last_synced_at: syncedAt,
      });
    }

    const { error: upsertError } = await adminSupabase
      .from("external_fixtures")
      .upsert(rows, { onConflict: "provider,external_fixture_id" });

    if (upsertError) {
      return Response.json({ error: upsertError.message }, { status: 500 });
    }

    return Response.json({
      dry_run: false,
      season: {
        id: season.id,
        name: season.name,
        base_provider: season.base_provider,
        base_competition_code: season.base_competition_code,
      },
      window: { date_from: dateFrom, date_to: dateTo },
      provider_request: providerRequest,
      upserted_count: rows.length,
      last_synced_at: syncedAt,
    });
  } catch (error) {
    if (error instanceof FootballDataError) {
      return Response.json(
        {
          error: error.message,
          provider_status: error.status,
          x_requestcounter_reset: error.resetSeconds,
        },
        { status: error.status === 429 ? 429 : 502 },
      );
    }

    return Response.json(
      { error: error instanceof Error ? error.message : "External fixture import failed." },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handleImport(request);
}

export async function POST(request: NextRequest) {
  return handleImport(request);
}
