import { createAdminClient } from "@/utils/supabase/admin";
import {
  buildReminderEmailTemplate,
  getReminderEmailConfig,
  getSiteUrl,
  sendEmail,
} from "@/utils/email";

export const dynamic = "force-dynamic";

const PREDICTION_REMINDER_TYPE = "matchday_predictions";
const PICKER_REMINDER_TYPE = "daily_fixture_picker";
const TERMINAL_FIXTURE_STATUSES = ["completed", "postponed", "void"];

type SeasonRow = {
  id: string;
  name: string;
};

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
};

type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string;
};

type PredictionRow = {
  fixture_id: string;
  user_id: string;
};

type ReminderRow = {
  gameweek_id: string;
  user_id: string;
  reminder_type: string;
  reminder_date: string;
};

type MatchdayGameweek = GameweekRow & {
  fixtureIds: string[];
  firstKickoffToday: Date;
};

function getCronAdminClient() {
  try {
    return {
      supabase: createAdminClient(),
      error: null,
    };
  } catch (error) {
    return {
      supabase: null,
      error: error instanceof Error ? error.message : "Unknown Supabase error",
    };
  }
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

function getLondonDateString(value: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function formatGameweekName(gameweek: Pick<GameweekRow, "gameweek_number" | "name">) {
  return gameweek.name || `Gameweek ${gameweek.gameweek_number}`;
}

function isTerminalFixtureStatus(status: string) {
  return TERMINAL_FIXTURE_STATUSES.includes(status);
}

function buildPredictionReminderEmail({
  gameweekName,
  siteUrl,
}: {
  gameweekName: string;
  siteUrl: string;
}) {
  const buttonUrl = `${siteUrl}/predictions`;
  const subject = "Reminder: enter your predictions";
  const body = `Fixtures from ${gameweekName} kick off today and you still need to enter your predictions.`;
  const footer =
    "You received this because you have incomplete predictions for this gameweek.";
  const text = `Who You Got?

${body}

Enter predictions: ${buttonUrl}

${footer}`;
  const html = buildReminderEmailTemplate({
    eyebrow: "Predictions needed",
    title: "Reminder: enter your predictions",
    body,
    buttonLabel: "Enter predictions",
    buttonUrl,
    footer,
  });

  return { subject, text, html, buttonUrl };
}

function buildPickerReminderEmail({
  gameweekName,
  siteUrl,
}: {
  gameweekName: string;
  siteUrl: string;
}) {
  const buttonUrl = `${siteUrl}/pick-fixtures`;
  const subject = "You’re up to pick fixtures";
  const body = `You’re up to pick the fixtures for ${gameweekName}.`;
  const supportingText =
    "Choose the four fixtures so everyone can get their predictions in.";
  const footer =
    "You received this because you’re the assigned fixture picker for this gameweek.";
  const text = `Who You Got?

${body}

${supportingText}

Pick fixtures: ${buttonUrl}

${footer}`;
  const html = buildReminderEmailTemplate({
    eyebrow: "Fixture picker",
    title: "You’re up to pick fixtures",
    body,
    supportingText,
    buttonLabel: "Pick fixtures",
    buttonUrl,
    footer,
  });

  return { subject, text, html, buttonUrl };
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

    if (fixtures.length >= 4) {
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
  const emailConfig = getReminderEmailConfig();

  if (!emailConfig.isConfigured && !isDryRun) {
    console.warn(
      `Reminder cron skipped: missing ${emailConfig.missing.join(", ")}`,
    );

    return Response.json({
      ok: false,
      dryRun: isDryRun,
      warning: auth.warning,
      error: "Email is not configured.",
      missingEnv: emailConfig.missing,
      predictionRemindersSent: 0,
      pickerRemindersSent: 0,
      skipped: 0,
      errors: 0,
    });
  }

  const adminClient = getCronAdminClient();

  if (!adminClient.supabase) {
    console.error(
      `Reminder cron skipped: could not create Supabase admin client. ${adminClient.error}`,
    );

    return Response.json(
      {
        ok: false,
        dryRun: isDryRun,
        warning: auth.warning,
        error:
          "Supabase admin client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.",
        detail: adminClient.error,
        predictionRemindersSent: 0,
        pickerRemindersSent: 0,
        skipped: 0,
        errors: 1,
      },
      { status: 500 },
    );
  }

  const supabase = adminClient.supabase;

  const { error: reminderPreflightError } = await supabase
    .from("prediction_reminders")
    .select("id")
    .limit(1);

  if (reminderPreflightError) {
    console.error(
      `Reminder cron skipped: Supabase admin client cannot read prediction_reminders. ${reminderPreflightError.message}`,
    );

    return Response.json(
      {
        ok: false,
        dryRun: isDryRun,
        warning: auth.warning,
        error:
          "Supabase admin client cannot access prediction_reminders. Confirm SUPABASE_SECRET_KEY is the service-role key and the reminder table SQL has been run.",
        detail: reminderPreflightError.message,
        predictionRemindersSent: 0,
        pickerRemindersSent: 0,
        skipped: 0,
        errors: 1,
      },
      { status: 500 },
    );
  }

  const now = new Date();
  const londonToday = getLondonDateString(now);

  const { data: activeSeason, error: seasonError } = await supabase
    .from("seasons")
    .select("id, name")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (seasonError) {
    return Response.json(
      { ok: false, error: seasonError.message },
      { status: 500 },
    );
  }

  const season = activeSeason as SeasonRow | null;

  if (!season) {
    return Response.json({
      ok: true,
      dryRun: isDryRun,
      warning: auth.warning,
      londonDate: londonToday,
      checkedGameweeks: 0,
      predictionRemindersSent: 0,
      pickerRemindersSent: 0,
      skipped: 0,
      errors: 0,
      message: "No active season found.",
    });
  }

  const { data: gameweeks } = await supabase
    .from("gameweeks")
    .select("id, season_id, gameweek_number, name, fixture_picker_id")
    .eq("season_id", season.id)
    .order("gameweek_number", { ascending: true });

  const gameweekRows = (gameweeks as GameweekRow[] | null) ?? [];
  const gameweekIds = gameweekRows.map((gameweek) => gameweek.id);

  const { data: fixtures } =
    gameweekIds.length > 0
      ? await supabase
          .from("fixtures")
          .select("id, gameweek_id, kickoff_at, status")
          .in("gameweek_id", gameweekIds)
          .order("kickoff_at", { ascending: true })
      : { data: [] };

  const fixtureRows = (fixtures as FixtureRow[] | null) ?? [];
  const fixturesByGameweek = groupFixturesByGameweek(fixtureRows);
  const matchdayGameweeks: MatchdayGameweek[] = [];
  let skipped = 0;

  for (const gameweek of gameweekRows) {
    const gameweekFixtures = fixturesByGameweek.get(gameweek.id) ?? [];

    if (gameweekFixtures.length === 0) {
      skipped += 1;
      continue;
    }

    const actionableFixtures = gameweekFixtures
      .filter(
        (fixture) =>
          fixture.status === "scheduled" &&
          fixture.kickoff_at &&
          getLondonDateString(new Date(fixture.kickoff_at)) === londonToday &&
          new Date(fixture.kickoff_at) > now,
      )
      .sort(
        (a, b) =>
          new Date(a.kickoff_at!).getTime() - new Date(b.kickoff_at!).getTime(),
      );

    if (actionableFixtures.length === 0) {
      skipped += 1;
      continue;
    }

    matchdayGameweeks.push({
      ...gameweek,
      fixtureIds: actionableFixtures.map((fixture) => fixture.id),
      firstKickoffToday: new Date(actionableFixtures[0].kickoff_at!),
    });
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, display_name")
    .eq("status", "approved");

  const approvedUsers = ((profiles as ProfileRow[] | null) ?? []).filter(
    (profile) => Boolean(profile.email),
  );

  const matchdayFixtureIds = matchdayGameweeks.flatMap(
    (gameweek) => gameweek.fixtureIds,
  );

  const { data: predictions } =
    matchdayFixtureIds.length > 0
      ? await supabase
          .from("predictions")
          .select("fixture_id, user_id")
          .in("fixture_id", matchdayFixtureIds)
      : { data: [] };

  const predictionRows = (predictions as PredictionRow[] | null) ?? [];
  const predictionsByGameweekUser = new Map<string, Set<string>>();

  for (const gameweek of matchdayGameweeks) {
    const fixtureIdSet = new Set(gameweek.fixtureIds);

    for (const prediction of predictionRows) {
      if (!fixtureIdSet.has(prediction.fixture_id)) {
        continue;
      }

      const key = `${gameweek.id}:${prediction.user_id}`;
      const predictedFixtures = predictionsByGameweekUser.get(key) ?? new Set();
      predictedFixtures.add(prediction.fixture_id);
      predictionsByGameweekUser.set(key, predictedFixtures);
    }
  }

  const matchdayGameweekIds = matchdayGameweeks.map((gameweek) => gameweek.id);
  const { data: existingPredictionReminders } =
    matchdayGameweekIds.length > 0
      ? await supabase
          .from("prediction_reminders")
          .select("gameweek_id, user_id, reminder_type, reminder_date")
          .in("gameweek_id", matchdayGameweekIds)
          .eq("reminder_type", PREDICTION_REMINDER_TYPE)
          .eq("reminder_date", londonToday)
      : { data: [] };

  const existingPredictionReminderKeys = new Set(
    ((existingPredictionReminders as ReminderRow[] | null) ?? []).map(
      (reminder) => `${reminder.gameweek_id}:${reminder.user_id}`,
    ),
  );

  let predictionRemindersSent = 0;
  let pickerRemindersSent = 0;
  let errors = 0;
  const predictionSummaries: {
    gameweekId: string;
    gameweekName: string;
    firstKickoffToday: string;
    actionableFixtureCount: number;
    actionUrl: string;
    candidates: number;
    sent: number;
    skipped: number;
    errors: number;
  }[] = [];

  for (const gameweek of matchdayGameweeks) {
    let gameweekSent = 0;
    let gameweekSkipped = 0;
    let gameweekErrors = 0;

    for (const approvedUser of approvedUsers) {
      const key = `${gameweek.id}:${approvedUser.id}`;
      const predictedCount = predictionsByGameweekUser.get(key)?.size ?? 0;
      const missingCount = gameweek.fixtureIds.length - predictedCount;

      if (missingCount <= 0 || existingPredictionReminderKeys.has(key)) {
        skipped += 1;
        gameweekSkipped += 1;
        continue;
      }

      if (isDryRun) {
        predictionRemindersSent += 1;
        gameweekSent += 1;
        continue;
      }

      const email = buildPredictionReminderEmail({
        gameweekName: formatGameweekName(gameweek),
        siteUrl,
      });

      const result = await sendEmail({
        to: approvedUser.email!,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });

      if (!result.ok) {
        console.error(
          `Prediction reminder failed for ${approvedUser.id}/${gameweek.id}: ${result.error}`,
        );
        errors += 1;
        gameweekErrors += 1;
        continue;
      }

      const { error: reminderInsertError } = await supabase
        .from("prediction_reminders")
        .insert({
          season_id: season.id,
          gameweek_id: gameweek.id,
          user_id: approvedUser.id,
          reminder_type: PREDICTION_REMINDER_TYPE,
          reminder_date: londonToday,
        });

      if (reminderInsertError) {
        console.error(
          `DUPLICATE SEND RISK: prediction reminder email was sent but reminder log insert failed for ${approvedUser.id}/${gameweek.id}. ${reminderInsertError.message}`,
        );
        errors += 1;
        gameweekErrors += 1;
        continue;
      }

      existingPredictionReminderKeys.add(key);
      predictionRemindersSent += 1;
      gameweekSent += 1;
    }

    predictionSummaries.push({
      gameweekId: gameweek.id,
      gameweekName: formatGameweekName(gameweek),
      firstKickoffToday: gameweek.firstKickoffToday.toISOString(),
      actionableFixtureCount: gameweek.fixtureIds.length,
      actionUrl: `${siteUrl}/predictions`,
      candidates: approvedUsers.length,
      sent: gameweekSent,
      skipped: gameweekSkipped,
      errors: gameweekErrors,
    });
  }

  const pickerGameweek = await findNextActionablePickerGameweek({
    supabase,
    seasonId: season.id,
    gameweeks: gameweekRows,
    fixturesByGameweek,
    now,
  });

  let pickerSummary:
    | {
        candidateFound: true;
        gameweekId: string;
        gameweekName: string;
        pickerId: string;
        actionUrl: string;
        sent: number;
        skipped: number;
        errors: number;
      }
    | null = null;

  if (pickerGameweek?.fixture_picker_id) {
    const { data: pickerProfile } = await supabase
      .from("profiles")
      .select("id, email, display_name")
      .eq("id", pickerGameweek.fixture_picker_id)
      .eq("status", "approved")
      .maybeSingle();

    const picker = pickerProfile as ProfileRow | null;

    if (!picker?.email) {
      skipped += 1;
      pickerSummary = {
        candidateFound: true,
        gameweekId: pickerGameweek.id,
        gameweekName: formatGameweekName(pickerGameweek),
        pickerId: pickerGameweek.fixture_picker_id,
        actionUrl: `${siteUrl}/pick-fixtures`,
        sent: 0,
        skipped: 1,
        errors: 0,
      };
    } else {
      const { data: existingPickerReminder } = await supabase
        .from("prediction_reminders")
        .select("gameweek_id, user_id, reminder_type, reminder_date")
        .eq("gameweek_id", pickerGameweek.id)
        .eq("user_id", picker.id)
        .eq("reminder_type", PICKER_REMINDER_TYPE)
        .eq("reminder_date", londonToday)
        .maybeSingle();

      if (existingPickerReminder) {
        skipped += 1;
        pickerSummary = {
          candidateFound: true,
          gameweekId: pickerGameweek.id,
          gameweekName: formatGameweekName(pickerGameweek),
          pickerId: picker.id,
          actionUrl: `${siteUrl}/pick-fixtures`,
          sent: 0,
          skipped: 1,
          errors: 0,
        };
      } else if (isDryRun) {
        pickerRemindersSent += 1;
        pickerSummary = {
          candidateFound: true,
          gameweekId: pickerGameweek.id,
          gameweekName: formatGameweekName(pickerGameweek),
          pickerId: picker.id,
          actionUrl: `${siteUrl}/pick-fixtures`,
          sent: 1,
          skipped: 0,
          errors: 0,
        };
      } else {
        const email = buildPickerReminderEmail({
          gameweekName: formatGameweekName(pickerGameweek),
          siteUrl,
        });

        const result = await sendEmail({
          to: picker.email,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });

        if (!result.ok) {
          console.error(
            `Picker reminder failed for ${picker.id}/${pickerGameweek.id}: ${result.error}`,
          );
          errors += 1;
          pickerSummary = {
            candidateFound: true,
            gameweekId: pickerGameweek.id,
            gameweekName: formatGameweekName(pickerGameweek),
            pickerId: picker.id,
            actionUrl: `${siteUrl}/pick-fixtures`,
            sent: 0,
            skipped: 0,
            errors: 1,
          };
        } else {
          const { error: reminderInsertError } = await supabase
            .from("prediction_reminders")
            .insert({
              season_id: season.id,
              gameweek_id: pickerGameweek.id,
              user_id: picker.id,
              reminder_type: PICKER_REMINDER_TYPE,
              reminder_date: londonToday,
            });

          if (reminderInsertError) {
            console.error(
              `DUPLICATE SEND RISK: picker reminder email was sent but reminder log insert failed for ${picker.id}/${pickerGameweek.id}. ${reminderInsertError.message}`,
            );
            errors += 1;
            pickerSummary = {
              candidateFound: true,
              gameweekId: pickerGameweek.id,
              gameweekName: formatGameweekName(pickerGameweek),
              pickerId: picker.id,
              actionUrl: `${siteUrl}/pick-fixtures`,
              sent: 0,
              skipped: 0,
              errors: 1,
            };
          } else {
            pickerRemindersSent += 1;
            pickerSummary = {
              candidateFound: true,
              gameweekId: pickerGameweek.id,
              gameweekName: formatGameweekName(pickerGameweek),
              pickerId: picker.id,
              actionUrl: `${siteUrl}/pick-fixtures`,
              sent: 1,
              skipped: 0,
              errors: 0,
            };
          }
        }
      }
    }
  }

  return Response.json({
    ok: errors === 0,
    dryRun: isDryRun,
    warning: auth.warning,
    londonDate: londonToday,
    checkedGameweeks: gameweekRows.length,
    matchdayGameweeks: predictionSummaries,
    pickerReminder: pickerSummary ?? {
      candidateFound: false,
      reason: "No actionable fixture picker gameweek found.",
      actionUrl: `${siteUrl}/pick-fixtures`,
      sent: 0,
      skipped: 0,
      errors: 0,
    },
    pickerGameweek: pickerSummary,
    predictionRemindersSent,
    pickerRemindersSent,
    remindersSent: predictionRemindersSent + pickerRemindersSent,
    skipped,
    errors,
  });
}
