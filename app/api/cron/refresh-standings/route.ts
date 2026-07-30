import {
  FootballDataError,
  getEligibleActiveStandingsSeason,
  refreshTeamStandings,
} from "@/utils/team-standings";
import { createAdminClient } from "@/utils/supabase/admin";

export const dynamic = "force-dynamic";

function verifyCronRequest(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return {
      ok: false,
      status: 500,
      error: "CRON_SECRET is not configured.",
      warning: "CRON_SECRET is not set; refusing standings refresh.",
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

  const { season } = await getEligibleActiveStandingsSeason({ supabase });
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";

  if (!season) {
    return Response.json({
      ok: true,
      skipped_run: true,
      reason: "no eligible active football-data season",
      dry_run: dryRun,
      provider_calls_made: 0,
      results: [],
    });
  }

  try {
    const result = await refreshTeamStandings({
      supabase,
      season,
      competitionCode: season.base_competition_code!,
      dryRun,
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
          error instanceof Error ? error.message : "Could not refresh standings.",
      },
      { status: 500 },
    );
  }
}
