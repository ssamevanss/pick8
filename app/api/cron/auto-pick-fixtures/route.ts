import {
  autoPickMissingFixtures,
  getEligibleActiveAutoPickSeasons,
} from "@/utils/external-auto-pick";
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
      warning: "CRON_SECRET is not set; refusing auto-pick request.",
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
  const route = "/api/cron/auto-pick-fixtures";
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

  const { seasons, error: seasonsError } =
    await getEligibleActiveAutoPickSeasons({ supabase });
  const dryRun = scope.dryRun;
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

  if (seasonsError) {
    diagnostics.logError("eligible-seasons", seasonsError);
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
      candidate_gameweeks: [],
      created_count: 0,
      updated_gameweeks: 0,
      skipped: [],
    });
  }

  try {
    const results: Record<string, unknown>[] = [];
    let errorCount = 0;
    let createdCount = 0;
    let updatedGameweeks = 0;

    for (const season of scopedSeasons) {
      const seasonStartedAt = performance.now();

      try {
        const result = await autoPickMissingFixtures({
          supabase,
          season,
          dryRun,
        });
        createdCount += result.created_count;
        updatedGameweeks += result.updated_gameweeks;
        results.push({
          ...result,
          ok: true,
          elapsedMs: Math.round(performance.now() - seasonStartedAt),
          candidate_gameweeks: result.candidate_gameweeks.slice(0, 10),
          skipped: capItems(result.skipped, 20),
        });
      } catch (error) {
        errorCount += 1;
        diagnostics.logError("season", error, {
          seasonId: season.id,
          leagueId: season.league_id,
          competitionCode: season.base_competition_code,
        });
        results.push({
          ok: false,
          seasonId: season.id,
          leagueId: season.league_id,
          competitionCode: season.base_competition_code,
          elapsedMs: Math.round(performance.now() - seasonStartedAt),
          ...getCronErrorSummary(error),
        });
      }
    }

    const response = {
      ok: errorCount === 0,
      route,
      phase: "complete",
      skipped_run: false,
      dryRun,
      eligibleSeasonCount: filteredSeasons.length,
      seasonsAttempted: scopedSeasons.length,
      providerConfigCount: 0,
      apiCallCount: 0,
      errorCount,
      elapsedMs: diagnostics.elapsedMs(),
      results,
      created_count: createdCount,
      updated_gameweeks: updatedGameweeks,
    };

    return Response.json(response, {
      status:
        errorCount === 0 ? 200 : errorCount < scopedSeasons.length ? 207 : 500,
    });
  } catch (autoPickError) {
    diagnostics.logError("setup", autoPickError);
    return Response.json(
      {
        ok: false,
        route,
        phase: "setup",
        dryRun,
        eligibleSeasonCount: filteredSeasons.length,
        providerConfigCount: 0,
        apiCallCount: 0,
        elapsedMs: diagnostics.elapsedMs(),
        ...getCronErrorSummary(autoPickError),
      },
      { status: 500 },
    );
  }
}
