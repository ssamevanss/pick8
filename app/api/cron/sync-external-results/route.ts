import {
  FootballDataError,
  fetchExternalResultProviderSnapshot,
  getCronSyncFixtures,
  getEligibleActiveSyncSeasons,
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
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";

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

  const { seasons, error: seasonError } = await getEligibleActiveSyncSeasons({
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

  if (seasons.length === 0) {
    return Response.json({
      ok: true,
      skipped_run: true,
      reason: "no eligible active season",
      dry_run: dryRun,
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
    const fixtureResults = await Promise.all(
      seasons.map((season) =>
        getCronSyncFixtures({
          supabase: adminSupabase,
          seasonId: season.id,
        }),
      ),
    );
    const fixtureError = fixtureResults.find((result) => result.error)?.error;

    if (fixtureError) {
      throw new Error(fixtureError.message);
    }

    const sharedProviderIds = [
      ...new Set(
        fixtureResults.flatMap((result) =>
          result.fixtures
            .map((fixture) => fixture.external_fixture_id)
            .filter((value): value is string => Boolean(value)),
        ),
      ),
    ];
    const providerSnapshot = await fetchExternalResultProviderSnapshot(
      sharedProviderIds,
    );
    const results = [];

    for (const [index, season] of seasons.entries()) {
      const fixtures = fixtureResults[index].fixtures;

      if (fixtures.length === 0) {
        results.push({
          season,
          fixtures_checked: 0,
          skipped_run: true,
          reason: "no selected external fixtures in sync window",
        });
        continue;
      }

      results.push(
        await syncExternalFixtureResults({
          supabase: adminSupabase,
          season,
          dryRun,
          fixtures,
          providerSnapshot,
        }),
      );
    }

    return Response.json({
      ok: true,
      skipped_run: false,
      dry_run: dryRun,
      seasons_processed: seasons.length,
      unique_provider_ids: sharedProviderIds.length,
      provider_api_call_count: providerSnapshot.apiCallCount,
      results,
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
