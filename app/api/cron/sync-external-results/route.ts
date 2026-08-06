import {
  FootballDataError,
  fetchExternalResultProviderSnapshot,
  getCronSyncFixtures,
  getEligibleActiveSyncSeasons,
  getFootballDataErrorResponse,
  syncExternalFixtureResults,
} from "@/utils/external-result-sync";
import { createAdminClient } from "@/utils/supabase/legacy-admin";
import {
  createCronDiagnostics,
  getCronErrorSummary,
  getCronScope,
} from "@/utils/cron-diagnostics";

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
  const route = "/api/cron/sync-external-results";
  const scope = getCronScope(request);
  const diagnostics = createCronDiagnostics({ route, dryRun: scope.dryRun });
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
  const dryRun = scope.dryRun;

  try {
    adminSupabase = createAdminClient();
  } catch (error) {
    diagnostics.logError("admin-client", error);
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
  const filteredSeasons = seasons.filter(
    (season) => !scope.seasonId || season.id === scope.seasonId,
  );
  const scopedSeasons = scope.limitConfigs
    ? filteredSeasons.slice(0, scope.limitConfigs)
    : filteredSeasons;

  diagnostics.log("eligible-seasons", {
    eligibleSeasonCount: filteredSeasons.length,
    seasonsAttempted: scopedSeasons.length,
    seasonIds: scopedSeasons.map((season) => season.id),
    leagueIds: scopedSeasons.map((season) => season.league_id),
  });

  if (seasonError) {
    diagnostics.logError("eligible-seasons", seasonError);
    return Response.json(
      {
        ok: false,
        route,
        phase: "eligible-seasons",
        dryRun,
        eligibleSeasonCount: 0,
        providerConfigCount: 0,
        apiCallCount: 0,
        error: seasonError.message,
      },
      { status: 500 },
    );
  }

  if (scopedSeasons.length === 0) {
    return Response.json({
      ok: true,
      route,
      phase: "complete",
      skipped_run: true,
      reason: "no eligible active season",
      dryRun,
      eligibleSeasonCount: 0,
      providerConfigCount: 0,
      apiCallCount: 0,
      elapsedMs: diagnostics.elapsedMs(),
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
      scopedSeasons.map((season) =>
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

    for (const [index, season] of scopedSeasons.entries()) {
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
      route,
      phase: "complete",
      skipped_run: false,
      dryRun,
      eligibleSeasonCount: filteredSeasons.length,
      seasonsAttempted: scopedSeasons.length,
      providerConfigCount: Math.ceil(sharedProviderIds.length / 20),
      apiCallCount: providerSnapshot.apiCallCount,
      elapsedMs: diagnostics.elapsedMs(),
      unique_provider_ids: sharedProviderIds.length,
      provider_api_call_count: providerSnapshot.apiCallCount,
      results,
    });
  } catch (error) {
    diagnostics.logError("sync", error, {
      eligibleSeasonCount: filteredSeasons.length,
    });
    if (error instanceof FootballDataError) {
      return Response.json(
        {
          ok: false,
          route,
          phase: "provider-fetch",
          dryRun,
          eligibleSeasonCount: filteredSeasons.length,
          providerConfigCount: 0,
          apiCallCount: 0,
          elapsedMs: diagnostics.elapsedMs(),
          ...getFootballDataErrorResponse(error),
        },
        { status: error.status === 429 ? 429 : 502 },
      );
    }

    return Response.json(
      {
        ok: false,
        route,
        phase: "sync",
        dryRun,
        eligibleSeasonCount: filteredSeasons.length,
        providerConfigCount: 0,
        apiCallCount: 0,
        elapsedMs: diagnostics.elapsedMs(),
        ...getCronErrorSummary(error),
      },
      { status: 500 },
    );
  }
}
