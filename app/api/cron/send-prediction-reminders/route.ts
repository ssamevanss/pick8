import {
  emailEnvironmentIsConfigured,
  sendPickerUpNextEmail,
  sendPredictionDeadlineReminderEmails,
} from "@/utils/email-notifications";
import { getSiteUrl } from "@/utils/email";
import { getFixtureSelectionStatus } from "@/utils/fixture-selection";
import { createAdminClient } from "@/utils/supabase/admin";

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

async function getPreviousGameweekComplete({
  supabase,
  seasonId,
  gameweekNumber,
}: {
  supabase: ReturnType<typeof createAdminClient>;
  seasonId: string;
  gameweekNumber: number;
}) {
  if (gameweekNumber === 1) {
    return true;
  }

  const { data: previousGameweek } = await supabase
    .from("gameweeks")
    .select("id")
    .eq("season_id", seasonId)
    .eq("gameweek_number", gameweekNumber - 1)
    .maybeSingle();

  if (!previousGameweek) {
    return false;
  }

  const { data: previousFixtures } = await supabase
    .from("fixtures")
    .select("status")
    .eq("gameweek_id", previousGameweek.id);

  const fixtureList = (previousFixtures as { status: string }[] | null) ?? [];

  return (
    fixtureList.length > 0 &&
    fixtureList.every((fixture) => isTerminalFixtureStatus(fixture.status))
  );
}

async function findNextActionablePickerGameweek({
  supabase,
  seasonId,
  gameweeks,
  fixturesByGameweek,
  now,
}: {
  supabase: ReturnType<typeof createAdminClient>;
  seasonId: string;
  gameweeks: GameweekRow[];
  fixturesByGameweek: Map<string, FixtureRow[]>;
  now: Date;
}) {
  for (const gameweek of gameweeks) {
    if (!gameweek.fixture_picker_id) {
      continue;
    }

    const fixtures = fixturesByGameweek.get(gameweek.id) ?? [];
    const selectionStatus = getFixtureSelectionStatus(fixtures);

    if (selectionStatus.isComplete) {
      continue;
    }

    const previousComplete = await getPreviousGameweekComplete({
      supabase,
      seasonId,
      gameweekNumber: gameweek.gameweek_number,
    });

    if (!previousComplete) {
      continue;
    }

    const fixtureIds = fixtures.map((fixture) => fixture.id);
    const { data: existingPrediction } =
      fixtureIds.length > 0
        ? await supabase
            .from("predictions")
            .select("fixture_id")
            .in("fixture_id", fixtureIds)
            .limit(1)
            .maybeSingle()
        : { data: null };

    if (existingPrediction) {
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
  const isDryRun = url.searchParams.get("dry_run") === "1";
  const siteUrl = getSiteUrl(url.origin);

  if (!emailEnvironmentIsConfigured() && !isDryRun) {
    return Response.json({
      ok: false,
      dryRun: isDryRun,
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

  const { data: activeSeason, error: seasonError } = await supabase
    .from("seasons")
    .select("id, name")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (seasonError) {
    return Response.json(
      { ok: false, dryRun: isDryRun, error: seasonError.message },
      { status: 500 },
    );
  }

  if (!activeSeason) {
    return Response.json({
      ok: true,
      dryRun: isDryRun,
      warning: auth.warning,
      message: "No active season found.",
      pickerUpNext: [],
      predictionDeadlineReminders: [],
    });
  }

  const { data: gameweeks, error: gameweeksError } = await supabase
    .from("gameweeks")
    .select("id, season_id, gameweek_number, name, fixture_picker_id")
    .eq("season_id", activeSeason.id)
    .order("gameweek_number", { ascending: true });

  if (gameweeksError) {
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
    return Response.json(
      { ok: false, dryRun: isDryRun, error: fixturesError.message },
      { status: 500 },
    );
  }

  const now = new Date();
  const pickerGameweek = await findNextActionablePickerGameweek({
    supabase,
    seasonId: activeSeason.id,
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
  const predictionDeadlineResult = await sendPredictionDeadlineReminderEmails({
    supabase,
    seasonId: activeSeason.id,
    dryRun: isDryRun,
    now,
    siteUrl,
  });
  const allSummaries = [
    ...pickerResult.summaries,
    ...predictionDeadlineResult.summaries,
  ];
  const errorCount = allSummaries.filter(
    (summary) => summary.status === "error",
  ).length;
  const sentCount = allSummaries.filter((summary) =>
    ["sent", "would_send"].includes(summary.status),
  ).length;

  return Response.json({
    ok: errorCount === 0 && !pickerResult.error && !predictionDeadlineResult.error,
    dryRun: isDryRun,
    warning: auth.warning,
    season: activeSeason,
    pickerUpNext: pickerResult.summaries,
    pickerUpNextError: pickerResult.error,
    predictionDeadlineReminders: predictionDeadlineResult.summaries,
    predictionDeadlineError: predictionDeadlineResult.error,
    sentOrWouldSend: sentCount,
    errors: errorCount,
  });
}
