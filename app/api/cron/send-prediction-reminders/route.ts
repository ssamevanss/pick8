import { createAdminClient } from "@/utils/supabase/admin";
import { getReminderEmailConfig, sendEmail } from "@/utils/email";

export const dynamic = "force-dynamic";

const REMINDER_TYPE = "three_hour";
const WINDOW_START_MS = 2.5 * 60 * 60 * 1000;
const WINDOW_END_MS = 3.5 * 60 * 60 * 1000;

type SeasonRow = {
  id: string;
  name: string;
};

type GameweekRow = {
  id: string;
  season_id: string;
  gameweek_number: number;
  name: string | null;
};

type FixtureRow = {
  id: string;
  gameweek_id: string;
  kickoff_at: string | null;
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
};

type DueGameweek = GameweekRow & {
  fixtureIds: string[];
  firstKickoff: Date;
};

function verifyCronRequest(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return {
      ok: true,
      warning: "CRON_SECRET is not set; route accepted without secret check.",
    };
  }

  const authorization = request.headers.get("authorization");
  const token = new URL(request.url).searchParams.get("token");

  if (authorization === `Bearer ${cronSecret}` || token === cronSecret) {
    return { ok: true, warning: null };
  }

  return { ok: false, warning: null };
}

function formatGameweekName(gameweek: GameweekRow) {
  return gameweek.name || `Gameweek ${gameweek.gameweek_number}`;
}

function formatKickoff(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
    timeZoneName: "short",
  }).format(value);
}

function buildReminderEmail({
  displayName,
  gameweekName,
  seasonName,
  firstKickoff,
  missingCount,
}: {
  displayName: string;
  gameweekName: string;
  seasonName: string;
  firstKickoff: Date;
  missingCount: number;
}) {
  const kickoffText = formatKickoff(firstKickoff);
  const subject = `Prediction reminder: ${gameweekName}`;
  const greeting = displayName ? `Hi ${displayName},` : "Hi,";
  const text = `${greeting}

${gameweekName} in ${seasonName} kicks off at ${kickoffText}.

You still have ${missingCount} prediction${missingCount === 1 ? "" : "s"} to enter. Please add them before the first kickoff.

Football Predictor`;

  const html = `
    <p>${greeting}</p>
    <p><strong>${gameweekName}</strong> in ${seasonName} kicks off at ${kickoffText}.</p>
    <p>You still have <strong>${missingCount}</strong> prediction${missingCount === 1 ? "" : "s"} to enter. Please add them before the first kickoff.</p>
    <p>Football Predictor</p>
  `;

  return { subject, text, html };
}

export async function GET(request: Request) {
  const auth = verifyCronRequest(request);

  if (!auth.ok) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const isDryRun = url.searchParams.get("dry_run") === "1";
  const emailConfig = getReminderEmailConfig();

  if (!emailConfig.isConfigured && !isDryRun) {
    console.warn(
      `Prediction reminder cron skipped: missing ${emailConfig.missing.join(
        ", ",
      )}`,
    );

    return Response.json({
      ok: false,
      dryRun: isDryRun,
      warning: auth.warning,
      error: "Email is not configured.",
      missingEnv: emailConfig.missing,
      checkedGameweeks: 0,
      remindersSent: 0,
      skipped: 0,
      errors: 0,
    });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const windowStart = new Date(now.getTime() + WINDOW_START_MS);
  const windowEnd = new Date(now.getTime() + WINDOW_END_MS);

  const { data: activeSeason, error: seasonError } = await supabase
    .from("seasons")
    .select("id, name")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (seasonError) {
    return Response.json({ ok: false, error: seasonError.message }, { status: 500 });
  }

  const season = activeSeason as SeasonRow | null;

  if (!season) {
    return Response.json({
      ok: true,
      dryRun: isDryRun,
      warning: auth.warning,
      checkedGameweeks: 0,
      remindersSent: 0,
      skipped: 0,
      errors: 0,
      message: "No active season found.",
    });
  }

  const { data: gameweeks } = await supabase
    .from("gameweeks")
    .select("id, season_id, gameweek_number, name")
    .eq("season_id", season.id)
    .order("gameweek_number", { ascending: true });

  const gameweekRows = (gameweeks as GameweekRow[] | null) ?? [];
  const gameweekIds = gameweekRows.map((gameweek) => gameweek.id);

  const { data: fixtures } =
    gameweekIds.length > 0
      ? await supabase
          .from("fixtures")
          .select("id, gameweek_id, kickoff_at")
          .in("gameweek_id", gameweekIds)
          .order("kickoff_at", { ascending: true })
      : { data: [] };

  const fixtureRows = (fixtures as FixtureRow[] | null) ?? [];
  const fixturesByGameweek = new Map<string, FixtureRow[]>();

  for (const fixture of fixtureRows) {
    const list = fixturesByGameweek.get(fixture.gameweek_id) ?? [];
    list.push(fixture);
    fixturesByGameweek.set(fixture.gameweek_id, list);
  }

  const dueGameweeks: DueGameweek[] = [];
  let skipped = 0;

  for (const gameweek of gameweekRows) {
    const gameweekFixtures = fixturesByGameweek.get(gameweek.id) ?? [];

    if (gameweekFixtures.length < 4) {
      skipped += 1;
      continue;
    }

    const kickoffDates = gameweekFixtures
      .map((fixture) =>
        fixture.kickoff_at ? new Date(fixture.kickoff_at) : null,
      )
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => a.getTime() - b.getTime());

    const firstKickoff = kickoffDates[0];

    if (
      !firstKickoff ||
      firstKickoff <= now ||
      firstKickoff < windowStart ||
      firstKickoff > windowEnd
    ) {
      skipped += 1;
      continue;
    }

    dueGameweeks.push({
      ...gameweek,
      fixtureIds: gameweekFixtures.map((fixture) => fixture.id),
      firstKickoff,
    });
  }

  if (dueGameweeks.length === 0) {
    return Response.json({
      ok: true,
      dryRun: isDryRun,
      warning: auth.warning,
      checkedGameweeks: 0,
      remindersSent: 0,
      skipped,
      errors: 0,
      dueGameweeks: [],
    });
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, display_name")
    .eq("status", "approved");

  const approvedUsers = ((profiles as ProfileRow[] | null) ?? []).filter(
    (profile) => Boolean(profile.email),
  );

  const dueFixtureIds = dueGameweeks.flatMap((gameweek) => gameweek.fixtureIds);

  const { data: predictions } =
    dueFixtureIds.length > 0
      ? await supabase
          .from("predictions")
          .select("fixture_id, user_id")
          .in("fixture_id", dueFixtureIds)
      : { data: [] };

  const predictionRows = (predictions as PredictionRow[] | null) ?? [];
  const predictionsByGameweekUser = new Map<string, Set<string>>();

  for (const gameweek of dueGameweeks) {
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

  const dueGameweekIds = dueGameweeks.map((gameweek) => gameweek.id);
  const { data: existingReminders } = await supabase
    .from("prediction_reminders")
    .select("gameweek_id, user_id, reminder_type")
    .in("gameweek_id", dueGameweekIds)
    .eq("reminder_type", REMINDER_TYPE);

  const existingReminderKeys = new Set(
    ((existingReminders as ReminderRow[] | null) ?? []).map(
      (reminder) => `${reminder.gameweek_id}:${reminder.user_id}`,
    ),
  );

  let remindersSent = 0;
  let errors = 0;
  const dueGameweekSummaries: {
    gameweekId: string;
    gameweekName: string;
    firstKickoff: string;
    candidates: number;
    sent: number;
    skipped: number;
    errors: number;
  }[] = [];

  for (const gameweek of dueGameweeks) {
    let gameweekSent = 0;
    let gameweekSkipped = 0;
    let gameweekErrors = 0;

    for (const approvedUser of approvedUsers) {
      const key = `${gameweek.id}:${approvedUser.id}`;
      const predictedCount =
        predictionsByGameweekUser.get(key)?.size ?? 0;
      const missingCount = gameweek.fixtureIds.length - predictedCount;

      if (missingCount <= 0 || existingReminderKeys.has(key)) {
        skipped += 1;
        gameweekSkipped += 1;
        continue;
      }

      if (isDryRun) {
        remindersSent += 1;
        gameweekSent += 1;
        continue;
      }

      const email = buildReminderEmail({
        displayName: approvedUser.display_name,
        gameweekName: formatGameweekName(gameweek),
        seasonName: season.name,
        firstKickoff: gameweek.firstKickoff,
        missingCount,
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
          reminder_type: REMINDER_TYPE,
        });

      if (reminderInsertError) {
        console.error(
          `Prediction reminder log insert failed for ${approvedUser.id}/${gameweek.id}: ${reminderInsertError.message}`,
        );
        errors += 1;
        gameweekErrors += 1;
        continue;
      }

      existingReminderKeys.add(key);
      remindersSent += 1;
      gameweekSent += 1;
    }

    dueGameweekSummaries.push({
      gameweekId: gameweek.id,
      gameweekName: formatGameweekName(gameweek),
      firstKickoff: gameweek.firstKickoff.toISOString(),
      candidates: approvedUsers.length,
      sent: gameweekSent,
      skipped: gameweekSkipped,
      errors: gameweekErrors,
    });
  }

  return Response.json({
    ok: errors === 0,
    dryRun: isDryRun,
    warning: auth.warning,
    checkedGameweeks: dueGameweeks.length,
    remindersSent,
    skipped,
    errors,
    dueGameweeks: dueGameweekSummaries,
  });
}
