import {
  getEligibleActiveStandingsSeasons,
  refreshTeamStandings,
} from "@/utils/team-standings";
import { createAdminClient } from "@/utils/supabase/legacy-admin";
import { getFootballDataSeasonQueryValue } from "@/utils/football-data/client";
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
  const route = "/api/cron/refresh-standings";
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

  const { seasons, error: seasonsError } =
    await getEligibleActiveStandingsSeasons({ supabase });
  const dryRun = scope.dryRun;
  const scopedSeasons = seasons.filter(
    (season) =>
      (!scope.seasonId || season.id === scope.seasonId) &&
      (!scope.competitionCode ||
        season.base_competition_code === scope.competitionCode),
  );

  diagnostics.log("eligible-seasons", {
    eligibleSeasonCount: scopedSeasons.length,
    seasonIds: scopedSeasons.map((season) => season.id),
    leagueIds: scopedSeasons.map((season) => season.league_id),
    competitionCodes: scopedSeasons.map(
      (season) => season.base_competition_code,
    ),
    providerSeasons: scopedSeasons.map((season) => season.provider_season),
  });

  if (seasonsError) {
    return Response.json(
      {
        ok: false,
        route,
        phase: "eligible-seasons",
        dryRun,
        eligibleSeasonCount: 0,
        providerConfigCount: 0,
        apiCallCount: 0,
        error: seasonsError.message,
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
      reason: "no eligible active football-data season",
      dryRun,
      eligibleSeasonCount: 0,
      providerConfigCount: 0,
      apiCallCount: 0,
      elapsedMs: diagnostics.elapsedMs(),
      results: [],
    });
  }

  try {
    const uniqueConfigurations = new Map(
      scopedSeasons.map((season) => [
        `${season.base_competition_code}:${
          getFootballDataSeasonQueryValue(season.provider_season) ?? "current"
        }`,
        season,
      ]),
    );
    const allConfigurations = [...uniqueConfigurations.values()];
    const selectedConfigurations = scope.limitConfigs
      ? allConfigurations.slice(0, scope.limitConfigs)
      : allConfigurations;
    const results = [];
    let errorCount = 0;
    let apiCallCount = 0;
    let stoppedReason: string | null = null;
    let failureStatus = 502;

    diagnostics.log("provider-configs", {
      eligibleSeasonCount: scopedSeasons.length,
      providerConfigCount: allConfigurations.length,
      configsAttempted: selectedConfigurations.length,
    });

    for (const season of selectedConfigurations) {
      const configStartedAt = performance.now();
      apiCallCount += 1;

      try {
        const result = await refreshTeamStandings({
          supabase,
          season,
          competitionCode: season.base_competition_code!,
          dryRun,
        });
        results.push({
          ok: true,
          leagueId: season.league_id,
          elapsedMs: Math.round(performance.now() - configStartedAt),
          ...result,
        });
      } catch (error) {
        errorCount += 1;
        const errorSummary = getCronErrorSummary(error);
        failureStatus =
          errorSummary.providerStatus === 429 ||
          errorSummary.providerStatus === 504
            ? errorSummary.providerStatus
            : 502;
        diagnostics.logError("provider-config", error, {
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
          elapsedMs: Math.round(performance.now() - configStartedAt),
          ...errorSummary,
        });

        if (errorSummary.providerStatus === 429) {
          stoppedReason = "provider rate limited; remaining configs not attempted";
          break;
        }
      }
    }

    const response = {
      ok: errorCount === 0,
      route,
      phase: "complete",
      skipped_run: false,
      dryRun,
      eligibleSeasonCount: scopedSeasons.length,
      providerConfigCount: allConfigurations.length,
      configsAttempted: selectedConfigurations.length,
      apiCallCount,
      errorCount,
      stoppedReason,
      elapsedMs: diagnostics.elapsedMs(),
      results,
    };

    return Response.json(response, {
      status:
        errorCount === 0
          ? 200
          : errorCount < selectedConfigurations.length
            ? 207
            : failureStatus,
    });
  } catch (error) {
    diagnostics.logError("setup", error);

    return Response.json(
      {
        ok: false,
        route,
        phase: "setup",
        dryRun,
        eligibleSeasonCount: scopedSeasons.length,
        providerConfigCount: 0,
        apiCallCount: 0,
        elapsedMs: diagnostics.elapsedMs(),
        ...getCronErrorSummary(error),
      },
      { status: 500 },
    );
  }
}
