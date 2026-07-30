import { FootballDataError } from "@/utils/football-data/client";
import {
  addDays,
  formatDateOnly,
  importExternalFixturesForSeason,
  loadExternalFixtureImportSeason,
  validateDateWindow,
} from "@/utils/external-fixture-import";
import { createAdminClient } from "@/utils/supabase/admin";

export const dynamic = "force-dynamic";

function verifyCronRequest(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return {
      ok: false,
      status: 500,
      error: "CRON_SECRET is not configured.",
      warning: "CRON_SECRET is not set; refusing external fixture import.",
    };
  }

  const authorization = request.headers.get("authorization");
  const token = new URL(request.url).searchParams.get("token");

  if (authorization === `Bearer ${cronSecret}` || token === cronSecret) {
    return { ok: true, warning: null };
  }

  return {
    ok: false,
    status: 401,
    error: "Unauthorized",
    warning: null,
  };
}

function readDryRun(request: Request) {
  return new URL(request.url).searchParams.get("dry_run") === "1";
}

async function getCompetitionCodes({
  supabase,
  baseCompetitionCode,
  includeEnabled,
}: {
  supabase: ReturnType<typeof createAdminClient>;
  baseCompetitionCode: string;
  includeEnabled: boolean;
}) {
  if (!includeEnabled) {
    return [baseCompetitionCode];
  }

  const { data, error } = await supabase
    .from("external_competitions")
    .select("external_competition_code")
    .eq("provider", "football_data")
    .eq("enabled", true)
    .order("display_order", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const enabledCodes = ((data as { external_competition_code: string }[] | null) ?? [])
    .map((row) => row.external_competition_code)
    .filter(Boolean);

  return [...new Set([baseCompetitionCode, ...enabledCodes])];
}

export async function GET(request: Request) {
  const auth = verifyCronRequest(request);

  if (!auth.ok) {
    return Response.json(
      {
        ok: false,
        error: auth.error,
        warning: auth.warning,
      },
      { status: auth.status },
    );
  }

  let supabase: ReturnType<typeof createAdminClient>;

  try {
    supabase = createAdminClient();
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not create Supabase admin client.",
      },
      { status: 500 },
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const dryRun = readDryRun(request);
  const now = new Date();
  const dateFrom = searchParams.get("date_from") ?? formatDateOnly(addDays(now, -2));
  const dateTo = searchParams.get("date_to") ?? formatDateOnly(addDays(now, 60));
  const dateError = validateDateWindow(dateFrom, dateTo);

  if (dateError) {
    return Response.json({ ok: false, error: dateError }, { status: 400 });
  }

  const { season, error: seasonError } = await loadExternalFixtureImportSeason({
    supabase,
    seasonId: null,
  });

  if (seasonError) {
    return Response.json(
      {
        ok: true,
        skipped_run: true,
        reason: seasonError,
        dry_run: dryRun,
        provider_calls_made: 0,
        results: [],
      },
      { status: seasonError.includes("No season") ? 200 : 500 },
    );
  }

  if (
    !season ||
    season.status !== "active" ||
    season.base_provider !== "football_data" ||
    !season.base_competition_code
  ) {
    return Response.json({
      ok: true,
      skipped_run: true,
      reason: "no eligible active football-data season",
      dry_run: dryRun,
      provider_calls_made: 0,
      results: [],
    });
  }

  if (!dryRun && !season.fixture_import_enabled) {
    return Response.json(
      {
        ok: false,
        error:
          "Fixture import is disabled for this season. Enable fixture_import_enabled before scheduled import.",
      },
      { status: 403 },
    );
  }

  try {
    const competitionCodes = await getCompetitionCodes({
      supabase,
      baseCompetitionCode: season.base_competition_code,
      includeEnabled: searchParams.get("include_enabled") === "1",
    });
    const results = [];
    let providerCallsMade = 0;

    for (const competitionCode of competitionCodes) {
      const result = await importExternalFixturesForSeason({
        supabase,
        season,
        competitionCode,
        dateFrom,
        dateTo,
        dryRun,
      });
      providerCallsMade += result.provider_calls_made;
      results.push(result);
    }

    return Response.json({
      ok: true,
      skipped_run: false,
      dry_run: dryRun,
      window: { date_from: dateFrom, date_to: dateTo },
      competition_codes: competitionCodes,
      provider_calls_made: providerCallsMade,
      results,
    });
  } catch (error) {
    if (error instanceof FootballDataError) {
      return Response.json(
        {
          ok: false,
          error: error.message,
          provider_status: error.status,
          x_requestcounter_reset: error.resetSeconds,
        },
        { status: error.status === 429 ? 429 : 502 },
      );
    }

    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not import external fixtures.",
      },
      { status: 500 },
    );
  }
}
