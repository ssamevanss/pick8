"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getKickoffIso } from "@/utils/fixtures";
import { getActiveSeason } from "@/utils/seasons";
import { upsertActivityNotification } from "@/utils/activity";

const slotNumbers = [1, 2, 3, 4];

type FixtureStatusRow = {
  status: string;
};

type SavedFixtureRow = {
  id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
};

type GameweekWithPickerRow = {
  id: string;
  season_id: string;
  gameweek_number: number;
  name: string | null;
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

async function requireFixtureManagerForGameweek(gameweekId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: gameweek } = await supabase
    .from("gameweeks")
    .select("id, season_id, gameweek_number, fixture_picker_id")
    .eq("id", gameweekId)
    .single();

  const isAssignedPicker = gameweek?.fixture_picker_id === user.id;

  if (!gameweek || !isAssignedPicker) {
    redirect(
      `/pick-fixtures?error=${encodeURIComponent(
        "You are not assigned to manage this gameweek",
      )}`,
    );
  }

  const { data: activeSeason } = await getActiveSeason(supabase, "id");

  if (!activeSeason || gameweek.season_id !== activeSeason.id) {
    redirect(
      `/pick-fixtures?error=${encodeURIComponent(
        "This gameweek is not part of the active season",
      )}`,
    );
  }

  if (gameweek.gameweek_number !== 1) {
    const { data: previousGameweek } = await supabase
      .from("gameweeks")
      .select("id")
      .eq("season_id", gameweek.season_id)
      .eq("gameweek_number", gameweek.gameweek_number - 1)
      .maybeSingle();

    if (!previousGameweek) {
      redirect(
        `/pick-fixtures?error=${encodeURIComponent(
          "Previous gameweek has not been created",
        )}`,
      );
    }

    const { data: previousFixtures } = await supabase
      .from("fixtures")
      .select("status")
      .eq("gameweek_id", previousGameweek.id);

    const previousFixtureList =
      (previousFixtures as FixtureStatusRow[] | null) ?? [];

    const previousGameweekComplete =
      previousFixtureList.length > 0 &&
      previousFixtureList.every((fixture) =>
        ["completed", "postponed", "void"].includes(fixture.status),
      );

    if (!previousGameweekComplete) {
      redirect(
        `/pick-fixtures?error=${encodeURIComponent(
          "You can pick fixtures once the previous gameweek has been completed",
        )}`,
      );
    }
  }

  const { data: currentFixtures } = await supabase
    .from("fixtures")
    .select("id")
    .eq("gameweek_id", gameweekId);

  const currentFixtureIds =
    (currentFixtures as { id: string }[] | null)?.map((fixture) => fixture.id) ??
    [];

  if (currentFixtureIds.length > 0) {
    const { data: existingPrediction } = await supabase
      .from("predictions")
      .select("fixture_id")
      .in("fixture_id", currentFixtureIds)
      .limit(1)
      .maybeSingle();

    if (existingPrediction) {
      redirect(
        `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
          "Fixtures are locked because predictions have already been entered",
        )}`,
      );
    }
  }

  return { supabase };
}

async function upsertFixturesPickedActivity({
  supabase,
  gameweekId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  gameweekId: string;
}) {
  const { data: gameweek } = await supabase
    .from("gameweeks")
    .select(
      `
      id,
      season_id,
      gameweek_number,
      name,
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
    .select("id, home_team, away_team, kickoff_at")
    .eq("gameweek_id", gameweekId)
    .order("kickoff_at", { ascending: true });

  const fixtureList = (fixtures as SavedFixtureRow[] | null) ?? [];

  if (fixtureList.length < 4) {
    return;
  }

  const firstKickoff = fixtureList[0]?.kickoff_at;

  if (!firstKickoff) {
    return;
  }

  const pickerName = getPickerDisplayName(typedGameweek);
  const gameweekName = formatGameweekName(typedGameweek);
  const kickoffText = formatKickoffForActivity(firstKickoff);

  await upsertActivityNotification({
    eventKey: `fixtures_picked:${gameweekId}`,
    type: "fixtures_selected",
    title: `${pickerName} picked fixtures for ${gameweekName}`,
    body: `${pickerName} picked the fixtures for ${gameweekName}. ${gameweekName} starts at ${kickoffText}.`,
    metadata: {
        pickerName,
        gameweekId,
        gameweekName,
        firstKickoff: firstKickoff,
        kickoffText,
        fixtures: fixtureList.slice(0, 4).map((fixture) => ({
        homeTeam: fixture.home_team,
        awayTeam: fixture.away_team,
        kickoffAt: fixture.kickoff_at,
        })),
    },
    });
}

export async function savePickerFixtures(formData: FormData) {
  const gameweekId = String(formData.get("gameweek_id") ?? "");

  if (!gameweekId) {
    redirect(
      `/pick-fixtures?error=${encodeURIComponent("Missing gameweek details")}`,
    );
  }

  const { supabase } = await requireFixtureManagerForGameweek(gameweekId);

  for (const slotNumber of slotNumbers) {
    const fixtureId = String(formData.get(`fixture_id_${slotNumber}`) ?? "");
    const homeTeam = String(
      formData.get(`home_team_${slotNumber}`) ?? "",
    ).trim();
    const awayTeam = String(
      formData.get(`away_team_${slotNumber}`) ?? "",
    ).trim();
    const kickoffRaw = String(
      formData.get(`kickoff_at_${slotNumber}`) ?? "",
    );
    const competition =
      String(formData.get(`competition_${slotNumber}`) ?? "").trim() ||
      "Premier League";

    const hasAnyValue = Boolean(homeTeam || awayTeam || kickoffRaw);

    if (!hasAnyValue && fixtureId) {
      const { error: deleteError } = await supabase
        .from("fixtures")
        .delete()
        .eq("id", fixtureId)
        .eq("gameweek_id", gameweekId);

      if (deleteError) {
        redirect(
          `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
            deleteError.message,
          )}`,
        );
      }

      continue;
    }

    if (!hasAnyValue) {
      continue;
    }

    if (!homeTeam || !awayTeam || !kickoffRaw) {
      redirect(
        `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
          `Complete home team, away team and kickoff for Fixture ${slotNumber}`,
        )}`,
      );
    }

    const kickoffAt = getKickoffIso(kickoffRaw);

    if (fixtureId) {
      const { error: updateError } = await supabase
        .from("fixtures")
        .update({
          home_team: homeTeam,
          away_team: awayTeam,
          kickoff_at: kickoffAt,
          competition,
        })
        .eq("id", fixtureId)
        .eq("gameweek_id", gameweekId);

      if (updateError) {
        redirect(
          `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
            updateError.message,
          )}`,
        );
      }
    } else {
      const { error: insertError } = await supabase.from("fixtures").insert({
        gameweek_id: gameweekId,
        home_team: homeTeam,
        away_team: awayTeam,
        kickoff_at: kickoffAt,
        competition,
        status: "scheduled",
      });

      if (insertError) {
        redirect(
          `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
            insertError.message,
          )}`,
        );
      }
    }
  }

  try {
    await upsertFixturesPickedActivity({
      supabase,
      gameweekId,
    });
  } catch (error) {
    redirect(
      `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
        error instanceof Error
          ? error.message
          : "Could not create activity update",
      )}`,
    );
  }

  revalidatePath("/pick-fixtures");
  revalidatePath("/dashboard");

  redirect(`/pick-fixtures?gameweek=${gameweekId}&saved=1`);
}
