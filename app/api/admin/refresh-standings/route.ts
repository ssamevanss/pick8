import {
  FootballDataError,
  getEligibleActiveStandingsSeason,
  refreshTeamStandings,
} from "@/utils/team-standings";
import { createAdminClient } from "@/utils/supabase/legacy-admin";
import { createClient } from "@/utils/supabase/legacy-server";
import { requireApprovedAdminRoute } from "@/utils/supabase/route-auth";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const supabase = await createClient();
  const result = await requireApprovedAdminRoute(supabase);
  return { error: result.ok ? null : result.response };
}

async function handleRefreshStandings(request: Request) {
  const { error: authError } = await requireAdmin();

  if (authError) {
    return authError;
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
  const seasonId = searchParams.get("season_id");
  const dryRun = searchParams.get("dry_run") !== "0";

  if (!seasonId) {
    return Response.json({ error: "season_id is required" }, { status: 400 });
  }

  const { season, error: seasonError } = await getEligibleActiveStandingsSeason({
    supabase,
    seasonId,
  });

  if (!season) {
    return Response.json({
      ok: false,
      error: seasonError?.message ?? "Selected season is not an eligible active season",
    }, { status: seasonError ? 500 : 400 });
  }

  try {
    const result = await refreshTeamStandings({
      supabase,
      season,
      competitionCode:
        searchParams.get("competition_code") ?? season.base_competition_code!,
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

export async function GET(request: Request) {
  return handleRefreshStandings(request);
}

export async function POST(request: Request) {
  return handleRefreshStandings(request);
}
