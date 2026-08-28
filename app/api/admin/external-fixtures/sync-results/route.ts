import { NextRequest } from "next/server";
import {
  FootballDataError,
  getFootballDataErrorResponse,
  getManualSyncFixtures,
  getSeasonById,
  syncExternalFixtureResults,
} from "@/utils/external-result-sync";
import { createAdminClient } from "@/utils/supabase/legacy-admin";
import { createClient } from "@/utils/supabase/legacy-server";
import { requireApprovedAdminRoute } from "@/utils/supabase/route-auth";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const supabase = await createClient();
  const result = await requireApprovedAdminRoute(supabase);
  return { error: result.ok ? null : result.response };
}

async function handleSync(request: NextRequest, forceDryRun: boolean) {
  const { error: authError } = await requireAdmin();

  if (authError) {
    return authError;
  }

  const searchParams = request.nextUrl.searchParams;
  const seasonId = searchParams.get("season_id");
  const fixtureId = searchParams.get("fixture_id");
  const dryRun = forceDryRun || searchParams.get("dry_run") === "1";

  if (!seasonId) {
    return Response.json({ error: "season_id is required" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();
  const { season, error: seasonError } = await getSeasonById({
    supabase: adminSupabase,
    seasonId,
  });

  if (seasonError || !season) {
    return Response.json(
      { error: seasonError?.message ?? "Season not found" },
      { status: 404 },
    );
  }

  if (!dryRun && !season.result_sync_enabled) {
    return Response.json(
      {
        error:
          "Result sync is disabled for this season. Enable result sync in Admin Season Settings before running a real sync.",
      },
      { status: 403 },
    );
  }

  const { fixtures, error: fixturesError } = await getManualSyncFixtures({
    supabase: adminSupabase,
    seasonId,
    fixtureId,
  });

  if (fixturesError) {
    return Response.json({ error: fixturesError.message }, { status: 500 });
  }

  try {
    const result = await syncExternalFixtureResults({
      supabase: adminSupabase,
      season,
      dryRun,
      fixtures,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof FootballDataError) {
      return Response.json(getFootballDataErrorResponse(error), {
        status: error.status === 429 ? 429 : 502,
      });
    }

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not fetch football-data.org results.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handleSync(request, true);
}

export async function POST(request: NextRequest) {
  return handleSync(request, false);
}
