import {
  FootballDataError,
  getCronSyncFixtures,
  getEligibleActiveSyncSeason,
  getFootballDataErrorResponse,
  syncExternalFixtureResults,
} from "@/utils/external-result-sync";
import { createAdminClient } from "@/utils/supabase/admin";

export const dynamic = "force-dynamic";

function verifyCronRequest(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return {
      ok: false,
      status: 500,
      error: "CRON_SECRET is not configured.",
      warning: "CRON_SECRET is not set; refusing external result sync.",
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

  let adminSupabase: ReturnType<typeof createAdminClient>;

  try {
    adminSupabase = createAdminClient();
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

  const { season, error: seasonError } = await getEligibleActiveSyncSeason({
    supabase: adminSupabase,
  });

  if (seasonError) {
    return Response.json(
      {
        ok: false,
        error: seasonError.message,
      },
      { status: 500 },
    );
  }

  if (!season) {
    return Response.json({
      ok: true,
      skipped_run: true,
      reason: "no eligible active season",
      dry_run: false,
      fixtures_checked: 0,
      provider_ids: [],
      provider_status: 200,
      planned_updates: [],
      skipped: [],
      api_call_count: 0,
      updated_count: 0,
      scored_count: 0,
      recalculated_leaderboard: false,
    });
  }

  const { fixtures, error: fixturesError } = await getCronSyncFixtures({
    supabase: adminSupabase,
    seasonId: season.id,
  });

  if (fixturesError) {
    return Response.json(
      {
        ok: false,
        error: fixturesError.message,
      },
      { status: 500 },
    );
  }

  if (fixtures.length === 0) {
    return Response.json({
      ok: true,
      skipped_run: true,
      reason: "no selected external fixtures in sync window",
      dry_run: false,
      season,
      fixtures_checked: 0,
      provider_ids: [],
      provider_status: 200,
      planned_updates: [],
      skipped: [],
      api_call_count: 0,
      updated_count: 0,
      scored_count: 0,
      recalculated_leaderboard: false,
    });
  }

  try {
    const result = await syncExternalFixtureResults({
      supabase: adminSupabase,
      season,
      dryRun: false,
      fixtures,
    });

    return Response.json({
      ok: true,
      skipped_run: false,
      ...result,
    });
  } catch (error) {
    if (error instanceof FootballDataError) {
      return Response.json(
        {
          ok: false,
          ...getFootballDataErrorResponse(error),
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
            : "Could not fetch football-data.org results.",
      },
      { status: 500 },
    );
  }
}
