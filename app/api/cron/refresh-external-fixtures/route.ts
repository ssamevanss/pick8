import {
  FootballDataError,
  getEligibleActiveRefreshSeason,
  refreshExternalFixtures,
} from "@/utils/external-fixture-refresh";
import { createAdminClient } from "@/utils/supabase/admin";

export const dynamic = "force-dynamic";

function verifyCronRequest(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return {
      ok: false,
      status: 500,
      error: "CRON_SECRET is not configured.",
      warning: "CRON_SECRET is not set; refusing external fixture refresh.",
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

  const { season, error: seasonError } = await getEligibleActiveRefreshSeason({
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
      dry_run: new URL(request.url).searchParams.get("dry_run") === "1",
      provider_calls_made: 0,
      external_fixtures_checked: 0,
      external_fixtures_updated: 0,
      selected_app_fixtures_checked: 0,
      selected_app_fixtures_updated: 0,
      kickoff_changes: 0,
      team_name_changes: 0,
      planned_updates: [],
      skipped: [],
    });
  }

  try {
    const result = await refreshExternalFixtures({
      supabase: adminSupabase,
      season,
      dryRun: new URL(request.url).searchParams.get("dry_run") === "1",
    });

    return Response.json({
      ok: true,
      ...result,
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
            : "Could not refresh external fixtures.",
      },
      { status: 500 },
    );
  }
}
