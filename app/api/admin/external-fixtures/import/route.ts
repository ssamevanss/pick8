import { NextRequest } from "next/server";
import {
  FootballDataError,
} from "@/utils/football-data/client";
import {
  addDays,
  formatDateOnly,
  importExternalFixturesForSeason,
  loadExternalFixtureImportSeason,
  validateDateWindow,
} from "@/utils/external-fixture-import";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

type ImportRequestParams = {
  seasonId: string | null;
  competitionCode: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  dryRun: boolean;
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
    .select("role, status")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin" || profile.status !== "approved") {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { error: null };
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
    competitionCode: readParam("competition_code"),
    dateFrom: readParam("date_from"),
    dateTo: readParam("date_to"),
    dryRun: dryRunValue !== "0" && dryRunValue !== "false",
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

  let adminSupabase: ReturnType<typeof createAdminClient>;

  try {
    adminSupabase = createAdminClient();
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

  const loadedSeason = await loadExternalFixtureImportSeason({
    supabase: adminSupabase,
    seasonId: params.seasonId,
  });

  if (loadedSeason.error || !loadedSeason.season) {
    return Response.json(
      { error: loadedSeason.error },
      { status: loadedSeason.error.includes("not found") ? 404 : 400 },
    );
  }

  const { season } = loadedSeason;

  if (season.base_provider !== "football_data") {
    return Response.json(
      { error: "Season base_provider must be football_data before importing fixtures." },
      { status: 400 },
    );
  }

  const importCompetitionCode =
    params.competitionCode?.trim().toUpperCase() ??
    season.base_competition_code;

  if (!importCompetitionCode) {
    return Response.json(
      {
        error:
          "A competition_code or season base_competition_code is required before importing fixtures.",
      },
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
    const result = await importExternalFixturesForSeason({
      supabase: adminSupabase,
      season,
      competitionCode: importCompetitionCode,
      dateFrom,
      dateTo,
      dryRun: params.dryRun,
      syncedAt,
    });

    return Response.json(result);
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
