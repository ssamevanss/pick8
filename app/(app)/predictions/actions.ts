"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/legacy-server";
import { getActiveSeason } from "@/utils/seasons";
import { getSelectedLeagueForUser } from "@/utils/leagues";

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

function getPredictionsRedirectUrl(params: {
  gameweekId?: string | null;
  saved?: boolean;
  error?: string;
}) {
  const searchParams = new URLSearchParams();

  if (params.gameweekId) {
    searchParams.set("gameweek", params.gameweekId);
  }

  if (params.saved) {
    searchParams.set("saved", "1");
  }

  if (params.error) {
    searchParams.set("error", params.error);
  }

  const queryString = searchParams.toString();

  return queryString ? `/predictions?${queryString}` : "/predictions";
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
  const selectedGameweekId = String(formData.get("selected_gameweek_id") ?? "");

  if (fixtureIds.length === 0) {
    redirect(
      getPredictionsRedirectUrl({
        gameweekId: selectedGameweekId,
        error: "No fixtures found",
      }),
    );
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
      getPredictionsRedirectUrl({
        gameweekId: selectedGameweekId,
        error: fixturesError?.message ?? "Could not load fixtures",
      }),
    );
  }

  const { selectedLeague } = await getSelectedLeagueForUser(
    supabase,
    user.id,
  );
  const { data: activeSeason } = selectedLeague
    ? await getActiveSeason(supabase, "id", selectedLeague.id)
    : { data: null };

  if (!activeSeason) {
    redirect(
      getPredictionsRedirectUrl({
        gameweekId: selectedGameweekId,
        error: "No active season found",
      }),
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
    if (homeScoreRaw === null || awayScoreRaw === null) {
      continue;
    }

    if (
      String(homeScoreRaw).trim() === "" ||
      String(awayScoreRaw).trim() === ""
    ) {
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
      redirect(
        getPredictionsRedirectUrl({
          gameweekId: selectedGameweekId,
          error: "Invalid prediction",
        }),
      );
    }

    const fixture = fixtureById.get(fixtureId);

    if (!fixture) {
      redirect(
        getPredictionsRedirectUrl({
          gameweekId: selectedGameweekId,
          error: "Fixture not found",
        }),
      );
    }

    const seasonId = getSeasonId(fixture);
    const isDoubleGameweek = getIsDoubleGameweek(fixture);

    if (!seasonId) {
      redirect(
        getPredictionsRedirectUrl({
          gameweekId: selectedGameweekId,
          error: "Season not found for fixture",
        }),
      );
    }

    if (seasonId !== activeSeason.id) {
      redirect(
        getPredictionsRedirectUrl({
          gameweekId: selectedGameweekId,
          error: "This fixture is not part of the active season",
        }),
      );
    }

    const isLocked = new Date(fixture.kickoff_at) <= new Date();

    if (isLocked || fixture.status !== "scheduled") {
      redirect(
        getPredictionsRedirectUrl({
          gameweekId: selectedGameweekId,
          error: "One or more fixtures are locked",
        }),
      );
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
        getPredictionsRedirectUrl({
          gameweekId: selectedGameweekId,
          error: predictionError.message,
        }),
      );
    }

    if (isDoubleGameweek) {
      const { error: removeJokerError } = await supabase
        .from("joker_usage")
        .delete()
        .eq("fixture_id", fixtureId)
        .eq("user_id", user.id);

      if (removeJokerError) {
        redirect(
          getPredictionsRedirectUrl({
            gameweekId: selectedGameweekId,
            error: removeJokerError.message,
          }),
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
          getPredictionsRedirectUrl({
            gameweekId: selectedGameweekId,
            error: jokerCountError.message,
          }),
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
        redirect(
          getPredictionsRedirectUrl({
            gameweekId: selectedGameweekId,
            error: "You have already used all 3 Jokers",
          }),
        );
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
        redirect(
          getPredictionsRedirectUrl({
            gameweekId: selectedGameweekId,
            error: jokerError.message,
          }),
        );
      }
    } else {
      const { error: removeJokerError } = await supabase
        .from("joker_usage")
        .delete()
        .eq("fixture_id", fixtureId)
        .eq("user_id", user.id);

      if (removeJokerError) {
        redirect(
          getPredictionsRedirectUrl({
            gameweekId: selectedGameweekId,
            error: removeJokerError.message,
          }),
        );
      }
    }

    savedCount += 1;
  }

  revalidatePath("/predictions");
  revalidatePath("/dashboard");
  revalidatePath("/leaderboard");

  if (savedCount === 0) {
    redirect(
      getPredictionsRedirectUrl({
        gameweekId: selectedGameweekId,
        error: "No complete predictions to save",
      }),
    );
  }

  redirect(
    getPredictionsRedirectUrl({
      gameweekId: selectedGameweekId,
      saved: true,
    }),
  );
}
