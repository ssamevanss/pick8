import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { upsertActivityNotification } from "@/utils/activity";
import { sendPredictionsOpenEmails } from "@/utils/email-notifications";
import { getFixtureSelectionStatus } from "@/utils/fixture-selection";

type SupabaseLikeClient =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createAdminClient>;

type SavedFixtureRow = {
  id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  external_provider: string | null;
  external_fixture_id: string | null;
};

type GameweekWithPickerRow = {
  id: string;
  season_id: string;
  gameweek_number: number;
  name: string | null;
  is_double_gameweek: boolean | null;
  fixture_picker_id: string | null;
  profiles:
    | {
        display_name: string;
      }
    | {
        display_name: string;
      }[]
    | null;
};

type ActioningProfileRow = {
  display_name: string;
  role: string | null;
};

function getPickerDisplayName(gameweek: GameweekWithPickerRow) {
  if (Array.isArray(gameweek.profiles)) {
    return gameweek.profiles[0]?.display_name ?? "Someone";
  }

  return gameweek.profiles?.display_name ?? "Someone";
}

function formatGameweekName(gameweek: {
  gameweek_number: number;
  name: string | null;
}) {
  return gameweek.name || `Gameweek ${gameweek.gameweek_number}`;
}

function formatKickoffForActivity(kickoffAt: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(kickoffAt));
}

export async function upsertFixturesPickedActivity({
  supabase,
  gameweekId,
  actioningUserId,
  source = "manual",
}: {
  supabase: SupabaseLikeClient;
  gameweekId: string;
  actioningUserId?: string | null;
  source?: "manual" | "auto";
}) {
  const { data: gameweek } = await supabase
    .from("gameweeks")
    .select(
      `
      id,
      season_id,
      gameweek_number,
      name,
      is_double_gameweek,
      fixture_picker_id,
      profiles (
        display_name
      )
    `,
    )
    .eq("id", gameweekId)
    .single();

  if (!gameweek) {
    return;
  }

  const typedGameweek = gameweek as GameweekWithPickerRow;

  const { data: fixtures } = await supabase
    .from("fixtures")
    .select(
      "id, home_team, away_team, kickoff_at, external_provider, external_fixture_id",
    )
    .eq("gameweek_id", gameweekId)
    .order("kickoff_at", { ascending: true });

  const fixtureList = (fixtures as SavedFixtureRow[] | null) ?? [];

  if (fixtureList.length === 0) {
    return;
  }

  const eventKey = `fixtures_picked:${gameweekId}`;
  const selectionStatus = getFixtureSelectionStatus(fixtureList);

  if (!selectionStatus.isComplete) {
    const { data: existingNotification } = await supabase
      .from("notifications")
      .select("id")
      .eq("event_key", eventKey)
      .maybeSingle();

    if (!existingNotification) {
      return;
    }
  }

  const firstKickoff = fixtureList[0]?.kickoff_at;

  if (!firstKickoff) {
    return;
  }

  const pickerName = getPickerDisplayName(typedGameweek);
  const gameweekName = formatGameweekName(typedGameweek);
  const kickoffText = formatKickoffForActivity(firstKickoff);
  const doubleGameweekText = typedGameweek.is_double_gameweek
    ? " It is a Double Gameweek, so all points count 2x."
    : "";
  const { data: actioningProfile } = actioningUserId
    ? await supabase
        .from("profiles")
        .select("display_name, role")
        .eq("id", actioningUserId)
        .maybeSingle()
    : { data: null };
  const typedActioningProfile = actioningProfile as ActioningProfileRow | null;
  const adminPickedOnBehalf =
    typedActioningProfile?.role === "admin" &&
    actioningUserId !== typedGameweek.fixture_picker_id;
  const activityTitle =
    source === "auto"
      ? `Fixtures were auto-picked for ${pickerName} for ${gameweekName}`
      : adminPickedOnBehalf
        ? `Admin picked fixtures on ${pickerName}’s behalf for ${gameweekName}`
        : `${pickerName} picked fixtures for ${gameweekName}`;
  const activityBody =
    source === "auto"
      ? `Fixtures were auto-picked for ${pickerName} for ${gameweekName}. ${gameweekName} starts at ${kickoffText}.${doubleGameweekText}`
      : adminPickedOnBehalf
        ? `Admin picked the ${gameweekName} fixtures on ${pickerName}’s behalf. ${gameweekName} starts at ${kickoffText}.${doubleGameweekText}`
        : `${pickerName} picked the ${gameweekName} fixtures. ${gameweekName} starts at ${kickoffText}.${doubleGameweekText}`;

  await upsertActivityNotification({
    eventKey,
    type: "fixtures_selected",
    title: activityTitle,
    body: activityBody,
    seasonId: typedGameweek.season_id,
    gameweekId,
    metadata: {
      pickerName,
      actioningUserName: typedActioningProfile?.display_name ?? null,
      pickedByAdminOnBehalf: adminPickedOnBehalf,
      pickedAutomatically: source === "auto",
      gameweekId,
      gameweekName,
      fixtureCount: fixtureList.length,
      isDoubleGameweek: Boolean(typedGameweek.is_double_gameweek),
      firstKickoff,
      kickoffText,
      fixtures: fixtureList.map((fixture) => ({
        homeTeam: fixture.home_team,
        awayTeam: fixture.away_team,
        kickoffAt: fixture.kickoff_at,
      })),
    },
  });

  if (selectionStatus.isComplete) {
    try {
      const emailResult = await sendPredictionsOpenEmails({
        supabase: createAdminClient(),
        gameweekId,
        excludeUserId: actioningUserId ?? null,
      });

      if (emailResult.error) {
        console.warn(`Predictions-open email skipped: ${emailResult.error}`);
      }

      const errored = emailResult.summaries.filter(
        (summary) => summary.status === "error",
      );

      if (errored.length > 0) {
        console.warn(
          `Predictions-open email errors for ${gameweekId}: ${errored
            .map((summary) => `${summary.email ?? summary.user_id}: ${summary.reason}`)
            .join("; ")}`,
        );
      }
    } catch (error) {
      console.warn(
        `Predictions-open email skipped: ${
          error instanceof Error ? error.message : "unknown email error"
        }`,
      );
    }
  }
}
