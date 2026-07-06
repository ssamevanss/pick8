import { getReminderEmailConfig, getSiteUrl, sendEmail } from "@/utils/email";
import { getFixtureSelectionStatus } from "@/utils/fixture-selection";
import { createAdminClient } from "@/utils/supabase/admin";

type AdminSupabaseClient = ReturnType<typeof createAdminClient>;

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
  home_team: string;
  away_team: string;
  kickoff_at: string;
  status: string;
  external_provider: string | null;
  external_fixture_id: string | null;
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

type LoggedEmailInput = {
  supabase: AdminSupabaseClient;
  dryRun: boolean;
  seasonId: string;
  gameweekId: string;
  userId: string;
  emailType: EmailNotificationType;
  eventKey: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  metadata?: Record<string, unknown>;
};

export type EmailNotificationType =
  | "picker_up_next"
  | "predictions_open"
  | "predictions_24h";

export type EmailDeliverySummary = {
  event_key: string;
  email_type: EmailNotificationType;
  user_id: string;
  email: string | null;
  status: "would_send" | "sent" | "skipped" | "error";
  reason?: string;
};

const TERMINAL_FIXTURE_STATUSES = ["completed", "postponed", "void"];

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatGameweekName(gameweek: {
  gameweek_number: number;
  name: string | null;
}) {
  return gameweek.name || `Gameweek ${gameweek.gameweek_number}`;
}

function formatKickoffForEmail(kickoffAt: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(kickoffAt));
}

function getEmailTemplate({
  title,
  eyebrow,
  intro,
  fixtureList,
  buttonLabel,
  buttonUrl,
  footer,
}: {
  title: string;
  eyebrow: string;
  intro: string;
  fixtureList?: string[];
  buttonLabel: string;
  buttonUrl: string;
  footer: string;
}) {
  const fixtureItems = fixtureList
    ? fixtureList
        .map(
          (fixture) =>
            `<li style="margin:8px 0;color:#17231a;font-size:14px;line-height:1.45;">${escapeHtml(
              fixture,
            )}</li>`,
        )
        .join("")
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#f4f7f2;color:#17231a;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(intro)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7f2;margin:0;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:18px;border:1px solid #dfe8dc;box-shadow:0 12px 34px rgba(23,35,26,0.10);overflow:hidden;">
            <tr>
              <td style="background:#102016;padding:22px 24px;text-align:center;">
                <div style="color:#86efac;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Who You Got?</div>
                <div style="margin-top:8px;color:#f8fafc;font-size:24px;font-weight:800;line-height:1.2;">${escapeHtml(title)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px 24px;text-align:center;">
                <div style="display:inline-block;border-radius:999px;background:#ecfdf3;color:#166534;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:7px 11px;">${escapeHtml(eyebrow)}</div>
                <p style="margin:18px 0 0;color:#17231a;font-size:18px;font-weight:700;line-height:1.45;">${escapeHtml(intro)}</p>
                ${
                  fixtureList && fixtureList.length > 0
                    ? `<ul style="display:inline-block;margin:18px auto 0;padding-left:20px;text-align:left;">${fixtureItems}</ul>`
                    : ""
                }
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px auto 0;">
                  <tr>
                    <td align="center" bgcolor="#22c55e" style="border-radius:12px;">
                      <a href="${escapeHtml(buttonUrl)}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#22c55e;color:#102016;text-decoration:none;font-size:15px;font-weight:800;">${escapeHtml(buttonLabel)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #e5eee2;padding:16px 24px 22px;text-align:center;">
                <p style="margin:0;color:#6b7a72;font-size:12px;line-height:1.5;">${escapeHtml(footer)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function getFixtureLines(fixtures: FixtureRow[]) {
  return fixtures.map(
    (fixture) =>
      `${fixture.home_team} vs ${fixture.away_team} - ${formatKickoffForEmail(
        fixture.kickoff_at,
      )}`,
  );
}

async function getExistingEmailNotification({
  supabase,
  eventKey,
}: {
  supabase: AdminSupabaseClient;
  eventKey: string;
}) {
  const { data, error } = await supabase
    .from("email_notifications")
    .select("id")
    .eq("event_key", eventKey)
    .maybeSingle();

  return { exists: Boolean(data), error };
}

async function sendLoggedEmail({
  supabase,
  dryRun,
  seasonId,
  gameweekId,
  userId,
  emailType,
  eventKey,
  to,
  subject,
  text,
  html,
  metadata = {},
}: LoggedEmailInput): Promise<EmailDeliverySummary> {
  const { exists, error: existingError } = await getExistingEmailNotification({
    supabase,
    eventKey,
  });

  if (existingError) {
    return {
      event_key: eventKey,
      email_type: emailType,
      user_id: userId,
      email: to,
      status: "error",
      reason: existingError.message,
    };
  }

  if (exists) {
    return {
      event_key: eventKey,
      email_type: emailType,
      user_id: userId,
      email: to,
      status: "skipped",
      reason: "already sent",
    };
  }

  if (dryRun) {
    return {
      event_key: eventKey,
      email_type: emailType,
      user_id: userId,
      email: to,
      status: "would_send",
    };
  }

  const result = await sendEmail({
    to,
    subject,
    text,
    html,
  });

  if (!result.ok) {
    return {
      event_key: eventKey,
      email_type: emailType,
      user_id: userId,
      email: to,
      status: "error",
      reason: result.error,
    };
  }

  const { error: insertError } = await supabase
    .from("email_notifications")
    .insert({
      season_id: seasonId,
      gameweek_id: gameweekId,
      user_id: userId,
      email_type: emailType,
      event_key: eventKey,
      metadata: {
        ...metadata,
        resendId: result.id,
      },
    });

  if (insertError) {
    return {
      event_key: eventKey,
      email_type: emailType,
      user_id: userId,
      email: to,
      status: "error",
      reason: `Email sent but log insert failed: ${insertError.message}`,
    };
  }

  return {
    event_key: eventKey,
    email_type: emailType,
    user_id: userId,
    email: to,
    status: "sent",
  };
}

async function getGameweek({
  supabase,
  gameweekId,
}: {
  supabase: AdminSupabaseClient;
  gameweekId: string;
}) {
  const { data, error } = await supabase
    .from("gameweeks")
    .select("id, season_id, gameweek_number, name, fixture_picker_id")
    .eq("id", gameweekId)
    .single();

  return { gameweek: data as GameweekRow | null, error };
}

async function getGameweekFixtures({
  supabase,
  gameweekId,
}: {
  supabase: AdminSupabaseClient;
  gameweekId: string;
}) {
  const { data, error } = await supabase
    .from("fixtures")
    .select(
      "id, gameweek_id, home_team, away_team, kickoff_at, status, external_provider, external_fixture_id",
    )
    .eq("gameweek_id", gameweekId)
    .order("kickoff_at", { ascending: true });

  return { fixtures: (data as FixtureRow[] | null) ?? [], error };
}

async function getApprovedEmailProfiles({ supabase }: { supabase: AdminSupabaseClient }) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name")
    .eq("status", "approved");

  return {
    profiles: ((data as ProfileRow[] | null) ?? []).filter((profile) =>
      Boolean(profile.email),
    ),
    error,
  };
}

export async function sendPickerUpNextEmail({
  supabase,
  gameweekId,
  dryRun = false,
  siteUrl = getSiteUrl(),
}: {
  supabase: AdminSupabaseClient;
  gameweekId: string;
  dryRun?: boolean;
  siteUrl?: string;
}) {
  const { gameweek, error: gameweekError } = await getGameweek({
    supabase,
    gameweekId,
  });

  if (gameweekError || !gameweek?.fixture_picker_id) {
    return {
      summaries: [] as EmailDeliverySummary[],
      error: gameweekError?.message ?? "No fixture picker assigned",
    };
  }

  const { data: picker, error: pickerError } = await supabase
    .from("profiles")
    .select("id, email, display_name")
    .eq("id", gameweek.fixture_picker_id)
    .eq("status", "approved")
    .maybeSingle();

  const typedPicker = picker as ProfileRow | null;

  if (pickerError) {
    return {
      summaries: [] as EmailDeliverySummary[],
      error: pickerError.message,
    };
  }

  if (!typedPicker?.email) {
    return {
      summaries: [
        {
          event_key: `picker_up_next:${gameweek.id}:${
            gameweek.fixture_picker_id
          }`,
          email_type: "picker_up_next",
          user_id: gameweek.fixture_picker_id,
          email: typedPicker?.email ?? null,
          status: "skipped",
          reason: "fixture picker has no approved email",
        },
      ],
      error: null,
    };
  }

  const { fixtures } = await getGameweekFixtures({
    supabase,
    gameweekId,
  });
  const selectionStatus = getFixtureSelectionStatus(fixtures);
  const gameweekName = formatGameweekName(gameweek);
  const buttonUrl = `${siteUrl}/pick-fixtures?gameweek=${gameweek.id}`;
  const fixtureText = selectionStatus.isComplete
    ? `${selectionStatus.selectedCount} fixture${
        selectionStatus.selectedCount === 1 ? "" : "s"
      }`
    : "the fixtures";
  const intro = `You're up next to pick ${fixtureText} for ${gameweekName}.`;
  const subject = "You’re up next to pick fixtures";
  const footer =
    "You received this because you are the assigned fixture picker for this gameweek.";
  const text = `Who You Got?

${intro}

Pick fixtures: ${buttonUrl}

${footer}`;
  const html = getEmailTemplate({
    title: subject,
    eyebrow: "Fixture picker",
    intro,
    buttonLabel: "Pick fixtures",
    buttonUrl,
    footer,
  });

  const summary = await sendLoggedEmail({
    supabase,
    dryRun,
    seasonId: gameweek.season_id,
    gameweekId: gameweek.id,
    userId: typedPicker.id,
    emailType: "picker_up_next",
    eventKey: `picker_up_next:${gameweek.id}:${typedPicker.id}`,
    to: typedPicker.email,
    subject,
    text,
    html,
    metadata: {
      gameweekName,
      pickerName: typedPicker.display_name,
    },
  });

  return { summaries: [summary], error: null };
}

export async function sendPredictionsOpenEmails({
  supabase,
  gameweekId,
  dryRun = false,
  siteUrl = getSiteUrl(),
}: {
  supabase: AdminSupabaseClient;
  gameweekId: string;
  dryRun?: boolean;
  siteUrl?: string;
}) {
  const { gameweek, error: gameweekError } = await getGameweek({
    supabase,
    gameweekId,
  });
  const { fixtures, error: fixtureError } = await getGameweekFixtures({
    supabase,
    gameweekId,
  });
  const { profiles, error: profileError } = await getApprovedEmailProfiles({
    supabase,
  });

  if (gameweekError || fixtureError || profileError || !gameweek) {
    return {
      summaries: [] as EmailDeliverySummary[],
      error:
        gameweekError?.message ??
        fixtureError?.message ??
        profileError?.message ??
        "Gameweek not found",
    };
  }

  const selectionStatus = getFixtureSelectionStatus(fixtures);

  if (!selectionStatus.isComplete) {
    return {
      summaries: [] as EmailDeliverySummary[],
      error: "Fixture selection is not complete",
    };
  }

  const gameweekName = formatGameweekName(gameweek);
  const buttonUrl = `${siteUrl}/predictions?gameweek=${gameweek.id}`;
  const fixtureLines = getFixtureLines(fixtures);
  const subject = `Predictions are open for ${gameweekName}`;
  const intro = `${gameweekName} fixtures have been selected. Predictions lock at each fixture kickoff.`;
  const footer =
    "You received this because you are an approved player in this league.";
  const text = `Who You Got?

${intro}

${fixtureLines.join("\n")}

Enter predictions: ${buttonUrl}

${footer}`;
  const html = getEmailTemplate({
    title: subject,
    eyebrow: "Predictions open",
    intro,
    fixtureList: fixtureLines,
    buttonLabel: "Enter predictions",
    buttonUrl,
    footer,
  });

  const summaries: EmailDeliverySummary[] = [];

  for (const profile of profiles) {
    summaries.push(
      await sendLoggedEmail({
        supabase,
        dryRun,
        seasonId: gameweek.season_id,
        gameweekId: gameweek.id,
        userId: profile.id,
        emailType: "predictions_open",
        eventKey: `predictions_open:${gameweek.id}:${profile.id}`,
        to: profile.email!,
        subject,
        text,
        html,
        metadata: {
          gameweekName,
          fixtureIds: fixtures.map((fixture) => fixture.id),
          fixtureCount: fixtures.length,
        },
      }),
    );
  }

  return { summaries, error: null };
}

function isTerminalFixtureStatus(status: string) {
  return TERMINAL_FIXTURE_STATUSES.includes(status);
}

export async function sendPredictionDeadlineReminderEmails({
  supabase,
  seasonId,
  dryRun = false,
  now = new Date(),
  siteUrl = getSiteUrl(),
}: {
  supabase: AdminSupabaseClient;
  seasonId: string;
  dryRun?: boolean;
  now?: Date;
  siteUrl?: string;
}) {
  const deadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const { data: gameweeks, error: gameweekError } = await supabase
    .from("gameweeks")
    .select("id, season_id, gameweek_number, name, fixture_picker_id")
    .eq("season_id", seasonId)
    .order("gameweek_number", { ascending: true });

  if (gameweekError) {
    return { summaries: [] as EmailDeliverySummary[], error: gameweekError.message };
  }

  const gameweekRows = (gameweeks as GameweekRow[] | null) ?? [];
  const gameweekIds = gameweekRows.map((gameweek) => gameweek.id);
  const { data: fixtures, error: fixtureError } =
    gameweekIds.length > 0
      ? await supabase
          .from("fixtures")
          .select(
            "id, gameweek_id, home_team, away_team, kickoff_at, status, external_provider, external_fixture_id",
          )
          .in("gameweek_id", gameweekIds)
          .order("kickoff_at", { ascending: true })
      : { data: [], error: null };

  if (fixtureError) {
    return { summaries: [] as EmailDeliverySummary[], error: fixtureError.message };
  }

  const fixtureRows = (fixtures as FixtureRow[] | null) ?? [];
  const fixturesByGameweek = new Map<string, FixtureRow[]>();

  for (const fixture of fixtureRows) {
    const list = fixturesByGameweek.get(fixture.gameweek_id) ?? [];
    list.push(fixture);
    fixturesByGameweek.set(fixture.gameweek_id, list);
  }

  const actionableByGameweek = new Map<string, FixtureRow[]>();
  const candidateGameweeks: GameweekRow[] = [];

  for (const gameweek of gameweekRows) {
    const selectedFixtures = fixturesByGameweek.get(gameweek.id) ?? [];
    const allTerminal =
      selectedFixtures.length > 0 &&
      selectedFixtures.every((fixture) => isTerminalFixtureStatus(fixture.status));

    if (allTerminal) {
      continue;
    }

    const futureScheduled = selectedFixtures.filter(
      (fixture) =>
        fixture.status === "scheduled" && new Date(fixture.kickoff_at) > now,
    );
    const hasFixtureWithin24h = futureScheduled.some((fixture) => {
      const kickoffAt = new Date(fixture.kickoff_at);
      return kickoffAt <= deadline;
    });

    if (futureScheduled.length === 0 || !hasFixtureWithin24h) {
      continue;
    }

    actionableByGameweek.set(gameweek.id, futureScheduled);
    candidateGameweeks.push(gameweek);
  }

  const { profiles, error: profileError } = await getApprovedEmailProfiles({
    supabase,
  });

  if (profileError) {
    return { summaries: [] as EmailDeliverySummary[], error: profileError.message };
  }

  const actionableFixtureIds = [...actionableByGameweek.values()].flatMap(
    (fixturesForGameweek) => fixturesForGameweek.map((fixture) => fixture.id),
  );
  const { data: predictions, error: predictionError } =
    actionableFixtureIds.length > 0
      ? await supabase
          .from("predictions")
          .select("fixture_id, user_id")
          .in("fixture_id", actionableFixtureIds)
      : { data: [], error: null };

  if (predictionError) {
    return {
      summaries: [] as EmailDeliverySummary[],
      error: predictionError.message,
    };
  }

  const predictionRows = (predictions as PredictionRow[] | null) ?? [];
  const predictedByUserGameweek = new Map<string, Set<string>>();

  for (const gameweek of candidateGameweeks) {
    const fixtureIds = new Set(
      (actionableByGameweek.get(gameweek.id) ?? []).map((fixture) => fixture.id),
    );

    for (const prediction of predictionRows) {
      if (!fixtureIds.has(prediction.fixture_id)) {
        continue;
      }

      const key = `${gameweek.id}:${prediction.user_id}`;
      const set = predictedByUserGameweek.get(key) ?? new Set<string>();
      set.add(prediction.fixture_id);
      predictedByUserGameweek.set(key, set);
    }
  }

  const summaries: EmailDeliverySummary[] = [];

  for (const gameweek of candidateGameweeks) {
    const actionableFixtures = actionableByGameweek.get(gameweek.id) ?? [];
    const gameweekName = formatGameweekName(gameweek);
    const buttonUrl = `${siteUrl}/predictions?gameweek=${gameweek.id}`;
    const fixtureLines = getFixtureLines(actionableFixtures);
    const subject = "Less than 24 hours to enter your predictions";
    const intro = `${gameweekName} has fixture${
      actionableFixtures.length === 1 ? "" : "s"
    } kicking off in the next 24 hours. Predictions lock at each kickoff.`;
    const footer =
      "You received this because you still have missing predictions for this gameweek.";
    const text = `Who You Got?

${intro}

${fixtureLines.join("\n")}

Enter predictions: ${buttonUrl}

${footer}`;
    const html = getEmailTemplate({
      title: subject,
      eyebrow: "Predictions deadline",
      intro,
      fixtureList: fixtureLines,
      buttonLabel: "Enter predictions",
      buttonUrl,
      footer,
    });

    for (const profile of profiles) {
      const predictedCount =
        predictedByUserGameweek.get(`${gameweek.id}:${profile.id}`)?.size ?? 0;

      if (predictedCount >= actionableFixtures.length) {
        summaries.push({
          event_key: `predictions_24h:${gameweek.id}:${profile.id}`,
          email_type: "predictions_24h",
          user_id: profile.id,
          email: profile.email,
          status: "skipped",
          reason: "all actionable fixtures predicted",
        });
        continue;
      }

      summaries.push(
        await sendLoggedEmail({
          supabase,
          dryRun,
          seasonId: gameweek.season_id,
          gameweekId: gameweek.id,
          userId: profile.id,
          emailType: "predictions_24h",
          eventKey: `predictions_24h:${gameweek.id}:${profile.id}`,
          to: profile.email!,
          subject,
          text,
          html,
          metadata: {
            gameweekName,
            fixtureIds: actionableFixtures.map((fixture) => fixture.id),
            fixtureCount: actionableFixtures.length,
          },
        }),
      );
    }
  }

  return { summaries, error: null };
}

export function emailEnvironmentIsConfigured() {
  return getReminderEmailConfig().isConfigured;
}
