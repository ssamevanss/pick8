import {
  emailEnvironmentIsConfigured,
  sendPickerUpNextEmail,
  sendPredictionDeadlineReminderEmails,
} from "@/utils/email-notifications";
import { getSiteUrl } from "@/utils/email";
import { getFixtureSelectionStatus } from "@/utils/fixture-selection";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  createCronDiagnostics,
  getCronScope,
} from "@/utils/cron-diagnostics";

export const dynamic = "force-dynamic";

const TERMINAL_FIXTURE_STATUSES = ["completed", "postponed", "void"];

type GameweekRow = {
  id: string;
  season_id: string;
  gameweek_number: number;
  name: string | null;
  fixture_picker_id: string | null;
};

type FixtureRow = {
  id: string;
  gameweek_id: string;
  kickoff_at: string | null;
  status: string;
  external_provider: string | null;
  external_fixture_id: string | null;
};

function summarizeDeliveryResult(result: {
  summaries: {
    event_key: string;
    email_type: string;
    user_id: string;
    status: string;
    reason?: string;
  }[];
  error: string | null;
}) {
  return {
    summaryCount: result.summaries.length,
    summaries: result.summaries.slice(0, 20).map((summary) => ({
      event_key: summary.event_key,
      email_type: summary.email_type,
      user_id: summary.user_id,
      status: summary.status,
      reason: summary.reason,
    })),
    error: result.error,
  };
}

function verifyCronRequest(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return {
      ok: false,
      status: 500,
      error: "CRON_SECRET is not configured.",
      warning: "CRON_SECRET is not set; refusing reminder cron request.",
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

function isTerminalFixtureStatus(status: string) {
  return TERMINAL_FIXTURE_STATUSES.includes(status);
}

function groupFixturesByGameweek(fixtures: FixtureRow[]) {
  const fixturesByGameweek = new Map<string, FixtureRow[]>();

  for (const fixture of fixtures) {
    const list = fixturesByGameweek.get(fixture.gameweek_id) ?? [];
    list.push(fixture);
    fixturesByGameweek.set(fixture.gameweek_id, list);
  }

  return fixturesByGameweek;
}

async function findNextActionablePickerGameweek({
  supabase,
  gameweeks,
  fixturesByGameweek,
  now,
}: {
  supabase: ReturnType<typeof createAdminClient>;
  gameweeks: GameweekRow[];
  fixturesByGameweek: Map<string, FixtureRow[]>;
  now: Date;
}) {
  const gameweekByNumber = new Map(
    gameweeks.map((gameweek) => [gameweek.gameweek_number, gameweek]),
  );
  const fixtureIds = [...fixturesByGameweek.values()].flatMap((fixtures) =>
    fixtures.map((fixture) => fixture.id),
  );
  const { data: predictionRows } = fixtureIds.length
    ? await supabase
        .from("predictions")
        .select("fixture_id")
        .in("fixture_id", fixtureIds)
    : { data: [] };
  const predictedFixtureIds = new Set(
    (predictionRows ?? []).map((prediction) => prediction.fixture_id),
  );

  for (const gameweek of gameweeks) {
    if (!gameweek.fixture_picker_id) {
      continue;
    }

    const fixtures = fixturesByGameweek.get(gameweek.id) ?? [];
    const selectionStatus = getFixtureSelectionStatus(fixtures);

    if (selectionStatus.isComplete) {
      continue;
    }

    const previousGameweek = gameweekByNumber.get(
      gameweek.gameweek_number - 1,
    );
    const previousFixtures = previousGameweek
      ? fixturesByGameweek.get(previousGameweek.id) ?? []
      : [];
    const previousComplete =
      gameweek.gameweek_number === 1 ||
      (previousFixtures.length > 0 &&
        previousFixtures.every((fixture) =>
          isTerminalFixtureStatus(fixture.status),
        ));

    if (!previousComplete) {
      continue;
    }

    if (fixtures.some((fixture) => predictedFixtureIds.has(fixture.id))) {
      continue;
    }

    const allFixturesClosed =
      fixtures.length > 0 &&
      fixtures.every((fixture) => isTerminalFixtureStatus(fixture.status));

    if (allFixturesClosed) {
      continue;
    }

    const allPickedFixturesKickedOff =
      fixtures.length > 0 &&
      fixtures.every(
        (fixture) => fixture.kickoff_at && new Date(fixture.kickoff_at) <= now,
      );

    if (allPickedFixturesKickedOff) {
      continue;
    }

    return gameweek;
  }

  return null;
}

export async function GET(request: Request) {
  const route = "/api/cron/send-prediction-reminders";
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

  const url = new URL(request.url);
  const isDryRun = scope.dryRun;
  const siteUrl = getSiteUrl(url.origin);

  if (!emailEnvironmentIsConfigured() && !isDryRun) {
    return Response.json({
      ok: false,
      route,
      phase: "configuration",
      dryRun: isDryRun,
      eligibleSeasonCount: 0,
      providerConfigCount: 0,
      apiCallCount: 0,
      warning: auth.warning,
      error: "Email is not configured.",
      pickerUpNext: [],
      predictionDeadlineReminders: [],
    });
  }

  let supabase: ReturnType<typeof createAdminClient>;

  try {
    supabase = createAdminClient();
  } catch (error) {
    diagnostics.logError("admin-client", error);
    return Response.json(
      {
        ok: false,
        dryRun: isDryRun,
        warning: auth.warning,
        error:
          error instanceof Error
            ? error.message
            : "Could not create Supabase admin client.",
      },
      { status: 500 },
    );
  }

  const { error: emailLogPreflightError } = await supabase
    .from("email_notifications")
    .select("id")
    .limit(1);

  if (emailLogPreflightError) {
    diagnostics.logError("email-log-preflight", emailLogPreflightError);
    return Response.json(
      {
        ok: false,
        dryRun: isDryRun,
        warning: auth.warning,
        error:
          "Supabase admin client cannot access email_notifications. Run the email notification SQL before enabling email cron.",
        detail: emailLogPreflightError.message,
      },
      { status: 500 },
    );
  }

  const { data: activeSeasons, error: seasonError } = await supabase
    .from("seasons")
    .select("id, league_id, name, leagues!inner(status)")
    .eq("status", "active")
    .eq("leagues.status", "active")
    .order("created_at", { ascending: true });

  if (seasonError) {
    diagnostics.logError("eligible-seasons", seasonError);
    return Response.json(
      {
        ok: false,
        route,
        phase: "eligible-seasons",
        dryRun: isDryRun,
        eligibleSeasonCount: 0,
        providerConfigCount: 0,
        apiCallCount: 0,
        error: seasonError.message,
      },
      { status: 500 },
    );
  }

  const filteredSeasons = (activeSeasons ?? []).filter(
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

  if (!scopedSeasons.length) {
    return Response.json({
      ok: true,
      route,
      phase: "complete",
      dryRun: isDryRun,
      warning: auth.warning,
      message: "No active season found.",
      pickerUpNext: [],
      predictionDeadlineReminders: [],
      eligibleSeasonCount: 0,
      providerConfigCount: 0,
      apiCallCount: 0,
      elapsedMs: diagnostics.elapsedMs(),
    });
  }

  const now = new Date();
  const seasonResults = [];

  for (const activeSeason of scopedSeasons) {
    const { data: gameweeks, error: gameweeksError } = await supabase
      .from("gameweeks")
      .select("id, season_id, gameweek_number, name, fixture_picker_id")
      .eq("season_id", activeSeason.id)
      .order("gameweek_number", { ascending: true });

    if (gameweeksError) {
      diagnostics.logError("gameweeks", gameweeksError, {
        seasonId: activeSeason.id,
        leagueId: activeSeason.league_id,
      });
      return Response.json(
        { ok: false, dryRun: isDryRun, error: gameweeksError.message },
        { status: 500 },
      );
    }

    const gameweekRows = (gameweeks as GameweekRow[] | null) ?? [];
    const gameweekIds = gameweekRows.map((gameweek) => gameweek.id);
    const { data: fixtures, error: fixturesError } =
      gameweekIds.length > 0
        ? await supabase
            .from("fixtures")
            .select(
              "id, gameweek_id, kickoff_at, status, external_provider, external_fixture_id",
            )
            .in("gameweek_id", gameweekIds)
            .order("kickoff_at", { ascending: true })
        : { data: [], error: null };

    if (fixturesError) {
      diagnostics.logError("fixtures", fixturesError, {
        seasonId: activeSeason.id,
        leagueId: activeSeason.league_id,
      });
      return Response.json(
        { ok: false, dryRun: isDryRun, error: fixturesError.message },
        { status: 500 },
      );
    }

    const pickerGameweek = await findNextActionablePickerGameweek({
      supabase,
      gameweeks: gameweekRows,
      fixturesByGameweek: groupFixturesByGameweek(
        (fixtures as FixtureRow[] | null) ?? [],
      ),
      now,
    });
    const pickerResult = pickerGameweek
      ? await sendPickerUpNextEmail({
          supabase,
          gameweekId: pickerGameweek.id,
          dryRun: isDryRun,
          siteUrl,
        })
      : { summaries: [], error: null };
    const predictionDeadlineResult =
      await sendPredictionDeadlineReminderEmails({
        supabase,
        seasonId: activeSeason.id,
        dryRun: isDryRun,
        now,
        siteUrl,
      });

    seasonResults.push({
      season: activeSeason,
      pickerResult,
      predictionDeadlineResult,
    });
  }
  const allSummaries = seasonResults.flatMap((result) => [
    ...result.pickerResult.summaries,
    ...result.predictionDeadlineResult.summaries,
  ]);
  const errorCount = allSummaries.filter(
    (summary) => summary.status === "error",
  ).length;
  const sentCount = allSummaries.filter((summary) =>
    ["sent", "would_send"].includes(summary.status),
  ).length;

  return Response.json({
    ok:
      errorCount === 0 &&
      seasonResults.every(
        (result) =>
          !result.pickerResult.error &&
          !result.predictionDeadlineResult.error,
      ),
    dryRun: isDryRun,
    route,
    phase: "complete",
    eligibleSeasonCount: filteredSeasons.length,
    providerConfigCount: 0,
    apiCallCount: 0,
    elapsedMs: diagnostics.elapsedMs(),
    warning: auth.warning,
    seasonsProcessed: seasonResults.length,
    results: seasonResults.map((result) => ({
      season: result.season,
      pickerResult: summarizeDeliveryResult(result.pickerResult),
      predictionDeadlineResult: summarizeDeliveryResult(
        result.predictionDeadlineResult,
      ),
    })),
    sentOrWouldSend: sentCount,
    errors: errorCount,
  });
}
