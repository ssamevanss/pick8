"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

const slotNumbers = [1, 2, 3, 4];

type FixtureStatusRow = {
  status: string;
};

function getKickoffIso(rawKickoff: string) {
  if (!rawKickoff) {
    return null;
  }

  return new Date(rawKickoff).toISOString();
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

  if (gameweek.gameweek_number === 1) {
    return { supabase };
  }

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

  return { supabase };
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

  revalidatePath("/pick-fixtures");
  revalidatePath("/dashboard");

  redirect(`/pick-fixtures?gameweek=${gameweekId}&saved=1`);
}