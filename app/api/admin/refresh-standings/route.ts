import {
  FootballDataError,
  getEligibleActiveStandingsSeason,
  refreshTeamStandings,
} from "@/utils/team-standings";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

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

  const { season } = await getEligibleActiveStandingsSeason({ supabase });
  const searchParams = new URL(request.url).searchParams;
  const dryRun = searchParams.get("dry_run") !== "0";

  if (!season) {
    return Response.json({
      ok: true,
      skipped_run: true,
      reason: "no eligible active football-data season",
      dry_run: dryRun,
      provider_calls_made: 0,
      fetched_count: 0,
      planned_updates: [],
    });
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
