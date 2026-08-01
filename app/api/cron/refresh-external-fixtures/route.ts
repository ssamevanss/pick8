import {
  fetchExternalFixtureRefreshProviderSnapshot,
  getEligibleActiveRefreshSeasons,
  refreshExternalFixtures,
} from "@/utils/external-fixture-refresh";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  capItems,
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
  const route = "/api/cron/refresh-external-fixtures";
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

  const { seasons, error: seasonError } = await getEligibleActiveRefreshSeasons({
    supabase: adminSupabase,
  });
  const filteredSeasons = seasons.filter(
    (season) =>
      (!scope.seasonId || season.id === scope.seasonId) &&
      (!scope.competitionCode ||
        season.base_competition_code === scope.competitionCode),
  );
  const scopedSeasons = scope.limitConfigs
    ? filteredSeasons.slice(0, scope.limitConfigs)
    : filteredSeasons;

  diagnostics.log("eligible-seasons", {
    eligibleSeasonCount: filteredSeasons.length,
    seasonsAttempted: scopedSeasons.length,
    seasonIds: scopedSeasons.map((season) => season.id),
    leagueIds: scopedSeasons.map((season) => season.league_id),
    competitionCodes: scopedSeasons.map(
      (season) => season.base_competition_code,
    ),
  });

  if (seasonError) {
    return Response.json(
      {
        ok: false,
        route,
        phase: "eligible-seasons",
        dryRun: scope.dryRun,
        eligibleSeasonCount: 0,
        providerConfigCount: 0,
        apiCallCount: 0,
        error: seasonError.message,
      },
      { status: 500 },
    );
  }

  const dryRun = scope.dryRun;

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
    const providerSnapshot = await fetchExternalFixtureRefreshProviderSnapshot({
      supabase: adminSupabase,
      seasons: scopedSeasons,
    });
    const results = [];
    let errorCount = 0;

    diagnostics.log("provider-snapshot", {
      eligibleSeasonCount: filteredSeasons.length,
      providerConfigCount:
        providerSnapshot.byRequestKey.size +
        providerSnapshot.errorsByRequestKey.size,
      apiCallCount: providerSnapshot.providerCallCount,
      failedProviderConfigs: providerSnapshot.errorsByRequestKey.size,
    });

    for (const season of scopedSeasons) {
      const seasonStartedAt = performance.now();

      try {
        const result = await refreshExternalFixtures({
          supabase: adminSupabase,
          season,
          dryRun,
          providerSnapshot,
        });
        results.push({
          ...result,
          ok: true,
          elapsedMs: Math.round(performance.now() - seasonStartedAt),
          planned_updates: capItems(result.planned_updates),
          skipped: capItems(result.skipped),
        });
      } catch (error) {
        errorCount += 1;
        diagnostics.logError("season-apply", error, {
          seasonId: season.id,
          leagueId: season.league_id,
          competitionCode: season.base_competition_code,
          providerSeason: season.provider_season,
        });
        results.push({
          ok: false,
          seasonId: season.id,
          leagueId: season.league_id,
          competitionCode: season.base_competition_code,
          providerSeason: season.provider_season,
          elapsedMs: Math.round(performance.now() - seasonStartedAt),
          ...getCronErrorSummary(error),
        });
      }
    }

    const providerConfigCount =
      providerSnapshot.byRequestKey.size +
      providerSnapshot.errorsByRequestKey.size;
    const response = {
      ok: errorCount === 0,
      route,
      phase: "complete",
      skipped_run: false,
      dryRun,
      eligibleSeasonCount: filteredSeasons.length,
      seasonsAttempted: scopedSeasons.length,
      providerConfigCount,
      apiCallCount: providerSnapshot.providerCallCount,
      errorCount,
      elapsedMs: diagnostics.elapsedMs(),
      providerErrors: [...providerSnapshot.errorsByRequestKey.values()],
      results,
    };
    const providerFailureStatus = [
      ...providerSnapshot.errorsByRequestKey.values(),
    ].find(
      (providerError) =>
        providerError.providerStatus === 429 ||
        providerError.providerStatus === 504,
    )?.providerStatus;

    return Response.json(response, {
      status:
        errorCount === 0
          ? 200
          : errorCount < scopedSeasons.length
            ? 207
            : (providerFailureStatus ?? 502),
    });
  } catch (error) {
    diagnostics.logError("provider-snapshot", error);

    return Response.json(
      {
        ok: false,
        route,
        phase: "provider-snapshot",
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
