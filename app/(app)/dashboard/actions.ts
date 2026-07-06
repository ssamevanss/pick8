"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

type FixtureLookupRow = {
  id: string;
  kickoff_at: string;
  status: string;
  gameweeks:
    | {
        season_id: string;
        is_double_gameweek: boolean | null;
      }
    | {
        season_id: string;
        is_double_gameweek: boolean | null;
      }[]
    | null;
};

function getSeasonId(fixture: FixtureLookupRow) {
  return Array.isArray(fixture.gameweeks)
    ? fixture.gameweeks[0]?.season_id
    : fixture.gameweeks?.season_id;
}

function getIsDoubleGameweek(fixture: FixtureLookupRow) {
  return Array.isArray(fixture.gameweeks)
    ? Boolean(fixture.gameweeks[0]?.is_double_gameweek)
    : Boolean(fixture.gameweeks?.is_double_gameweek);
}

async function getNonDoubleJokerCount({
  supabase,
  seasonId,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  seasonId: string;
  userId: string;
}) {
  const { data, error } = await supabase
    .from("joker_usage")
    .select(
      `
      id,
      fixtures!inner (
        gameweeks!inner (
          season_id,
          is_double_gameweek
        )
      )
    `,
    )
    .eq("season_id", seasonId)
    .eq("user_id", userId)
    .is("refunded_at", null)
    .eq("fixtures.gameweeks.season_id", seasonId);

  if (error) {
    return { count: null, error };
  }

  const rows =
    (data as
      | {
          fixtures:
            | {
                gameweeks:
                  | { is_double_gameweek: boolean | null }
                  | { is_double_gameweek: boolean | null }[]
                  | null;
              }
            | {
                gameweeks:
                  | { is_double_gameweek: boolean | null }
                  | { is_double_gameweek: boolean | null }[]
                  | null;
              }[]
            | null;
        }[]
      | null) ?? [];

  const count = rows.filter((row) => {
    const fixture = Array.isArray(row.fixtures) ? row.fixtures[0] : row.fixtures;
    const gameweek = Array.isArray(fixture?.gameweeks)
      ? fixture.gameweeks[0]
      : fixture?.gameweeks;

    return !gameweek?.is_double_gameweek;
  }).length;

  return { count, error: null };
}

export async function savePredictions(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login");
  }

  const fixtureIds = formData.getAll("fixture_id").map(String);

  if (fixtureIds.length === 0) {
    redirect("/dashboard?error=No fixtures found");
  }

  const { data: fixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select(
      `
      id,
      kickoff_at,
      status,
      gameweeks (
        season_id,
        is_double_gameweek
      )
    `,
    )
    .in("id", fixtureIds);

  if (fixturesError || !fixtures) {
    redirect(
      `/dashboard?error=${encodeURIComponent(
        fixturesError?.message ?? "Could not load fixtures",
      )}`,
    );
  }

  const fixtureById = new Map(
    (fixtures as FixtureLookupRow[]).map((fixture) => [fixture.id, fixture]),
  );

  let savedCount = 0;

  for (const fixtureId of fixtureIds) {
    const homeScoreRaw = formData.get(`home_score_${fixtureId}`);
    const awayScoreRaw = formData.get(`away_score_${fixtureId}`);
    const useJoker = formData.get(`use_joker_${fixtureId}`) === "on";

    // Skip incomplete rows entirely.
    if (homeScoreRaw === null || awayScoreRaw === null) continue;
    if (String(homeScoreRaw).trim() === "" || String(awayScoreRaw).trim() === "") {
      continue;
    }

    const homeScore = Number(homeScoreRaw);
    const awayScore = Number(awayScoreRaw);

    if (
      !Number.isInteger(homeScore) ||
      !Number.isInteger(awayScore) ||
      homeScore < 0 ||
      awayScore < 0
    ) {
      redirect("/dashboard?error=Invalid prediction");
    }

    const fixture = fixtureById.get(fixtureId);

    if (!fixture) {
      redirect("/dashboard?error=Fixture not found");
    }

    const isLocked = new Date(fixture.kickoff_at) <= new Date();

    if (isLocked || fixture.status !== "scheduled") {
      redirect("/dashboard?error=One or more fixtures are locked");
    }

    const { error: predictionError } = await supabase.from("predictions").upsert(
      {
        fixture_id: fixtureId,
        user_id: user.id,
        home_score: homeScore,
        away_score: awayScore,
      },
      {
        onConflict: "fixture_id,user_id",
      },
    );

    if (predictionError) {
      redirect(
        `/dashboard?error=${encodeURIComponent(predictionError.message)}`,
      );
    }

    const seasonId = getSeasonId(fixture);
    const isDoubleGameweek = getIsDoubleGameweek(fixture);

    if (!seasonId) {
      redirect("/dashboard?error=Season not found for fixture");
    }

    if (isDoubleGameweek) {
      const { error: removeJokerError } = await supabase
        .from("joker_usage")
        .delete()
        .eq("fixture_id", fixtureId)
        .eq("user_id", user.id);

      if (removeJokerError) {
        redirect(
          `/dashboard?error=${encodeURIComponent(removeJokerError.message)}`,
        );
      }
    } else if (useJoker) {
      const { count: jokerCount, error: jokerCountError } =
        await getNonDoubleJokerCount({
          supabase,
          seasonId,
          userId: user.id,
        });

      if (jokerCountError) {
        redirect(
          `/dashboard?error=${encodeURIComponent(jokerCountError.message)}`,
        );
      }

      const { data: existingJokerForFixture } = await supabase
        .from("joker_usage")
        .select("id")
        .eq("fixture_id", fixtureId)
        .eq("user_id", user.id)
        .is("refunded_at", null)
        .maybeSingle();

      const alreadyUsedOnThisFixture = Boolean(existingJokerForFixture);

      if ((jokerCount ?? 0) >= 3 && !alreadyUsedOnThisFixture) {
        redirect("/dashboard?error=You have already used all 3 Jokers");
      }

      const { error: jokerError } = await supabase.from("joker_usage").upsert(
        {
          season_id: seasonId,
          fixture_id: fixtureId,
          user_id: user.id,
        },
        {
          onConflict: "fixture_id,user_id",
        },
      );

      if (jokerError) {
        redirect(`/dashboard?error=${encodeURIComponent(jokerError.message)}`);
      }
    } else {
      const { error: removeJokerError } = await supabase
        .from("joker_usage")
        .delete()
        .eq("fixture_id", fixtureId)
        .eq("user_id", user.id);

      if (removeJokerError) {
        redirect(
          `/dashboard?error=${encodeURIComponent(removeJokerError.message)}`,
        );
      }
    }

    savedCount += 1;
  }

  revalidatePath("/dashboard");

  if (savedCount === 0) {
    redirect("/dashboard?error=No complete predictions to save");
  }

  redirect("/dashboard?saved=1");
}
