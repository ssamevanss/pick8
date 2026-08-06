import { getFootballDataSeasonQueryValue } from "@/utils/football-data/client";
import {
  addDays,
  formatDateOnly,
  importExternalFixturesForSeason,
  loadEligibleExternalFixtureImportSeasons,
  validateDateWindow,
} from "@/utils/external-fixture-import";
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
      warning: "CRON_SECRET is not set; refusing external fixture import.",
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

async function getCompetitionCodes({
  supabase,
  baseCompetitionCode,
  includeEnabled,
}: {
  supabase: ReturnType<typeof createAdminClient>;
  baseCompetitionCode: string;
  includeEnabled: boolean;
}) {
  if (!includeEnabled) {
    return [baseCompetitionCode];
  }

  const { data, error } = await supabase
    .from("external_competitions")
    .select("external_competition_code")
    .eq("provider", "football_data")
    .eq("enabled", true)
    .order("display_order", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const enabledCodes = ((data as { external_competition_code: string }[] | null) ?? [])
    .map((row) => row.external_competition_code)
    .filter(Boolean);

  return [...new Set([baseCompetitionCode, ...enabledCodes])];
}

export async function GET(request: Request) {
  const route = "/api/cron/import-external-fixtures";
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

  const searchParams = new URL(request.url).searchParams;
  const dryRun = scope.dryRun;
  const now = new Date();
  const dateFrom = searchParams.get("date_from") ?? formatDateOnly(addDays(now, -2));
  const dateTo = searchParams.get("date_to") ?? formatDateOnly(addDays(now, 60));
  const dateError = validateDateWindow(dateFrom, dateTo);

  if (dateError) {
    return Response.json({ ok: false, error: dateError }, { status: 400 });
  }

  const { seasons, error: seasonError } =
    await loadEligibleExternalFixtureImportSeasons({ supabase });
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
  });

  if (seasonError) {
    return Response.json(
      {
        ok: false,
        route,
        phase: "eligible-seasons",
        skipped_run: true,
        reason: seasonError.message,
        dryRun,
        eligibleSeasonCount: 0,
        providerConfigCount: 0,
        apiCallCount: 0,
        results: [],
      },
      { status: 500 },
    );
  }

  if (
    scopedSeasons.length === 0
  ) {
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
    const enabledCompetitionCodes = await getCompetitionCodes({
      supabase,
      baseCompetitionCode: scopedSeasons[0].base_competition_code!,
      includeEnabled:
        !scope.competitionCode && searchParams.get("include_enabled") === "1",
    });
    const tasks = new Map(
      scopedSeasons.map((season) => [
        `${season.base_competition_code}:${
          getFootballDataSeasonQueryValue(season.provider_season) ?? "current"
        }`,
        { season, competitionCode: season.base_competition_code! },
      ]),
    );

    for (const competitionCode of enabledCompetitionCodes) {
      if (
        ![...tasks.values()].some(
          (task) => task.competitionCode === competitionCode,
        )
      ) {
        tasks.set(`enabled:${competitionCode}`, {
          season: scopedSeasons[0],
          competitionCode,
        });
      }
    }

    const allTasks = [...tasks.values()];
    const selectedTasks = scope.limitConfigs
      ? allTasks.slice(0, scope.limitConfigs)
      : allTasks;
    const results = [];
    let apiCallCount = 0;
    let errorCount = 0;
    let stoppedReason: string | null = null;
    let failureStatus = 502;

    diagnostics.log("provider-configs", {
      eligibleSeasonCount: scopedSeasons.length,
      providerConfigCount: allTasks.length,
      configsAttempted: selectedTasks.length,
    });

    for (const { season, competitionCode } of selectedTasks) {
      const configStartedAt = performance.now();
      apiCallCount += 1;

      try {
        const result = await importExternalFixturesForSeason({
          supabase,
          season,
          competitionCode,
          dateFrom,
          dateTo,
          dryRun,
        });
        results.push({
          ok: true,
          seasonId: season.id,
          leagueId: season.league_id,
          competitionCode,
          providerSeason: season.provider_season,
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
          competitionCode,
          providerSeason: season.provider_season,
        });
        results.push({
          ok: false,
          seasonId: season.id,
          leagueId: season.league_id,
          competitionCode,
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
      window: { date_from: dateFrom, date_to: dateTo },
      eligibleSeasonCount: scopedSeasons.length,
      providerConfigCount: allTasks.length,
      configsAttempted: selectedTasks.length,
      competition_codes: [
        ...new Set(selectedTasks.map((task) => task.competitionCode)),
      ],
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
          : errorCount < selectedTasks.length
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
