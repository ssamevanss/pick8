import {
  FootballDataError,
  getEligibleActiveRefreshSeason,
  refreshExternalFixtures,
} from "@/utils/external-fixture-refresh";
import { createAdminClient } from "@/utils/supabase/legacy-admin";
import { createClient } from "@/utils/supabase/legacy-server";

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

async function handleRefresh(request: Request) {
  const { error: authError } = await requireAdmin();

  if (authError) {
    return authError;
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

  const searchParams = new URL(request.url).searchParams;
  const seasonId = searchParams.get("season_id");

  if (!seasonId) {
    return Response.json({ error: "season_id is required" }, { status: 400 });
  }

  const { season, error: seasonError } = await getEligibleActiveRefreshSeason({
    supabase: adminSupabase,
    seasonId,
  });

  if (seasonError) {
    return Response.json({ ok: false, error: seasonError.message }, { status: 500 });
  }

  if (!season) {
    return Response.json(
      {
        ok: false,
        error: "Selected season is not an eligible active season",
      },
      { status: 400 },
    );
  }

  try {
    const result = await refreshExternalFixtures({
      supabase: adminSupabase,
      season,
      dryRun: searchParams.get("dry_run") !== "0",
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

export async function GET(request: Request) {
  return handleRefresh(request);
}

export async function POST(request: Request) {
  return handleRefresh(request);
}
