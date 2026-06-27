"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fromZonedTime } from "date-fns-tz";
import { createClient } from "@/utils/supabase/server";

type LeaderboardPredictionRow = {
  user_id: string;
  points: number | null;
  is_exact_score: boolean;
  is_correct_result: boolean;
};

type PredictionToScore = {
  id: string;
  fixture_id: string;
  user_id: string;
  home_score: number;
  away_score: number;
};

type FixtureToScore = {
  id: string;
  home_score: number | null;
  away_score: number | null;
  gameweeks:
    | {
        season_id: string;
      }
    | {
        season_id: string;
      }[]
    | null;
};

async function requireAdmin() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/dashboard?error=Admin access required");
  }

  return { supabase, user };
}

function getSeasonIdFromFixture(fixture: FixtureToScore) {
  if (Array.isArray(fixture.gameweeks)) {
    return fixture.gameweeks[0]?.season_id ?? null;
  }

  return fixture.gameweeks?.season_id ?? null;
}

function getResult(homeScore: number, awayScore: number) {
  if (homeScore > awayScore) return "home";
  if (awayScore > homeScore) return "away";
  return "draw";
}

function calculatePoints({
  predictionHome,
  predictionAway,
  actualHome,
  actualAway,
  usedJoker,
}: {
  predictionHome: number;
  predictionAway: number;
  actualHome: number;
  actualAway: number;
  usedJoker: boolean;
}) {
  const isExactScore =
    predictionHome === actualHome && predictionAway === actualAway;

  const isCorrectResult =
    getResult(predictionHome, predictionAway) === getResult(actualHome, actualAway);

  let points = 0;

  if (isExactScore) {
    points = 5;
  } else if (isCorrectResult) {
    points = 3;
  }

  if (usedJoker) {
    points = points * 2;
  }

  return {
    points,
    isExactScore,
    isCorrectResult,
  };
}

async function scoreFixture(fixtureId: string) {
  const supabase = await createClient();

  const { data: fixture } = await supabase
    .from("fixtures")
    .select(
      `
      id,
      home_score,
      away_score,
      gameweeks (
        season_id
      )
    `,
    )
    .eq("id", fixtureId)
    .single();

  const typedFixture = fixture as FixtureToScore | null;

  if (
    !typedFixture ||
    typedFixture.home_score === null ||
    typedFixture.away_score === null
  ) {
    return null;
  }

  const { data: predictions } = await supabase
    .from("predictions")
    .select("id, fixture_id, user_id, home_score, away_score")
    .eq("fixture_id", fixtureId);

  const { data: jokers } = await supabase
    .from("joker_usage")
    .select("fixture_id, user_id")
    .eq("fixture_id", fixtureId)
    .is("refunded_at", null);

  const jokerKeys = new Set(
    ((jokers as { fixture_id: string; user_id: string }[] | null) ?? []).map(
      (joker) => `${joker.fixture_id}:${joker.user_id}`,
    ),
  );

  for (const prediction of (predictions as PredictionToScore[] | null) ?? []) {
    const usedJoker = jokerKeys.has(
      `${prediction.fixture_id}:${prediction.user_id}`,
    );

    const scored = calculatePoints({
      predictionHome: prediction.home_score,
      predictionAway: prediction.away_score,
      actualHome: typedFixture.home_score,
      actualAway: typedFixture.away_score,
      usedJoker,
    });

    await supabase
      .from("predictions")
      .update({
        points: scored.points,
        is_exact_score: scored.isExactScore,
        is_correct_result: scored.isCorrectResult,
      })
      .eq("id", prediction.id);
  }

  return getSeasonIdFromFixture(typedFixture);
}

async function recalculateLeaderboard(seasonId: string) {
  const supabase = await createClient();

  const { data: predictions } = await supabase
    .from("predictions")
    .select(
      `
      user_id,
      points,
      is_exact_score,
      is_correct_result,
      fixtures!inner (
        status,
        gameweeks!inner (
          season_id
        )
      )
    `,
    )
    .eq("fixtures.status", "completed")
    .eq("fixtures.gameweeks.season_id", seasonId);

  const totals = new Map<
    string,
    {
      userId: string;
      totalPoints: number;
      exactScores: number;
      correctResults: number;
    }
  >();

  for (const prediction of (predictions as LeaderboardPredictionRow[] | null) ?? []) {
    const current =
      totals.get(prediction.user_id) ??
      {
        userId: prediction.user_id,
        totalPoints: 0,
        exactScores: 0,
        correctResults: 0,
      };

    current.totalPoints += prediction.points ?? 0;

    if (prediction.is_exact_score) {
      current.exactScores += 1;
    }

    if (prediction.is_correct_result) {
      current.correctResults += 1;
    }

    totals.set(prediction.user_id, current);
  }

  const ranked = [...totals.values()]
    .sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) {
        return b.totalPoints - a.totalPoints;
      }

      if (b.exactScores !== a.exactScores) {
        return b.exactScores - a.exactScores;
      }

      return b.correctResults - a.correctResults;
    })
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

  for (const entry of ranked) {
    const { data: existing } = await supabase
      .from("leaderboard_entries")
      .select("rank")
      .eq("season_id", seasonId)
      .eq("user_id", entry.userId)
      .maybeSingle();

    await supabase.from("leaderboard_entries").upsert(
      {
        season_id: seasonId,
        user_id: entry.userId,
        total_points: entry.totalPoints,
        weekly_points: 0,
        exact_scores: entry.exactScores,
        correct_results: entry.correctResults,
        previous_rank: existing?.rank ?? null,
        rank: entry.rank,
      },
      {
        onConflict: "season_id,user_id",
      },
    );
  }
}

export async function createGameweekWithFixtures(formData: FormData) {
  const { supabase, user } = await requireAdmin();

  const seasonId = String(formData.get("season_id"));
  const gameweekNumber = Number(formData.get("gameweek_number"));
  const name = String(formData.get("name") || `Gameweek ${gameweekNumber}`);
  const fixturePickerIdRaw = formData.get("fixture_picker_id");
  const fixturePickerId =
    fixturePickerIdRaw && String(fixturePickerIdRaw).trim() !== ""
      ? String(fixturePickerIdRaw)
      : null;

  if (!seasonId || !Number.isInteger(gameweekNumber) || gameweekNumber < 1) {
    redirect("/admin?tab=create&error=Invalid gameweek");
  }

  const fixturesToCreate = [];

  for (const fixtureNumber of [1, 2, 3, 4]) {
    const homeTeam = String(
      formData.get(`home_team_${fixtureNumber}`) ?? "",
    ).trim();

    const awayTeam = String(
      formData.get(`away_team_${fixtureNumber}`) ?? "",
    ).trim();

    const kickoffRaw = String(
      formData.get(`kickoff_at_${fixtureNumber}`) ?? "",
    ).trim();

    const competition =
      String(formData.get(`competition_${fixtureNumber}`) ?? "").trim() ||
      "Premier League";

    const rowHasAnyValue = homeTeam || awayTeam || kickoffRaw;

    if (!rowHasAnyValue) {
      continue;
    }

    if (!homeTeam || !awayTeam || !kickoffRaw) {
      redirect(
        `/admin?tab=create&error=${encodeURIComponent(
          `Fixture ${fixtureNumber} is incomplete`,
        )}`,
      );
    }

    const kickoffAt = fromZonedTime(kickoffRaw, "Europe/London").toISOString();

    fixturesToCreate.push({
      home_team: homeTeam,
      away_team: awayTeam,
      kickoff_at: kickoffAt,
      competition,
      created_by: user.id,
    });
  }

  if (fixturesToCreate.length === 0) {
    redirect("/admin?tab=create&error=Add at least one fixture");
  }

  const { data: gameweek, error: gameweekError } = await supabase
    .from("gameweeks")
    .insert({
      season_id: seasonId,
      gameweek_number: gameweekNumber,
      name,
      fixture_picker_id: fixturePickerId,
    })
    .select("id")
    .single();

  if (gameweekError || !gameweek) {
    redirect(
      `/admin?tab=create&error=${encodeURIComponent(
        gameweekError?.message ?? "Could not create gameweek",
      )}`,
    );
  }

  const { error: fixturesError } = await supabase.from("fixtures").insert(
    fixturesToCreate.map((fixture) => ({
      ...fixture,
      gameweek_id: gameweek.id,
    })),
  );

  if (fixturesError) {
    redirect(
      `/admin?tab=create&error=${encodeURIComponent(fixturesError.message)}`,
    );
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");

  redirect(`/admin?tab=fixtures&gameweek=${gameweek.id}&saved=1`);
}

export async function addFixtureToGameweek(formData: FormData) {
  const { supabase, user } = await requireAdmin();

  const gameweekId = String(formData.get("gameweek_id"));
  const homeTeam = String(formData.get("home_team") ?? "").trim();
  const awayTeam = String(formData.get("away_team") ?? "").trim();
  const kickoffRaw = String(formData.get("kickoff_at") ?? "").trim();
  const competition =
    String(formData.get("competition") ?? "").trim() || "Premier League";

  if (!gameweekId || !homeTeam || !awayTeam || !kickoffRaw || !competition) {
    redirect(
      `/admin?tab=fixtures&error=${encodeURIComponent(
        "Fixture details are incomplete",
      )}`,
    );
  }

  const kickoffAt = fromZonedTime(kickoffRaw, "Europe/London").toISOString();

  const { error } = await supabase.from("fixtures").insert({
    gameweek_id: gameweekId,
    home_team: homeTeam,
    away_team: awayTeam,
    kickoff_at: kickoffAt,
    competition,
    created_by: user.id,
  });

  if (error) {
    redirect(
      `/admin?tab=fixtures&gameweek=${gameweekId}&error=${encodeURIComponent(
        error.message,
      )}`,
    );
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");

  redirect(`/admin?tab=fixtures&gameweek=${gameweekId}&saved=1`);
}

export async function updateUserProfile(formData: FormData) {
  const { supabase, user } = await requireAdmin();

  const userId = String(formData.get("user_id"));
  const displayName = String(formData.get("display_name") ?? "").trim();
  const role = String(formData.get("role"));

  if (!userId || !displayName) {
    redirect(
      `/admin?tab=users&error=${encodeURIComponent(
        "User details are incomplete",
      )}`,
    );
  }

  if (role !== "player" && role !== "admin") {
    redirect(
      `/admin?tab=users&error=${encodeURIComponent("Invalid user role")}`,
    );
  }

  if (userId === user.id && role !== "admin") {
    redirect(
      `/admin?tab=users&error=${encodeURIComponent(
        "You cannot remove your own admin role",
      )}`,
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      role,
    })
    .eq("id", userId);

  if (error) {
    redirect(
      `/admin?tab=users&error=${encodeURIComponent(error.message)}`,
    );
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/leaderboard");

  redirect("/admin?tab=users&saved=1");
}

export async function updateFixtureDetails(formData: FormData) {
  const { supabase } = await requireAdmin();

  const fixtureId = String(formData.get("fixture_id"));
  const homeTeam = String(formData.get("home_team") ?? "").trim();
  const awayTeam = String(formData.get("away_team") ?? "").trim();
  const kickoffRaw = String(formData.get("kickoff_at") ?? "").trim();
  const competition = String(formData.get("competition") ?? "").trim();

  if (!fixtureId || !homeTeam || !awayTeam || !kickoffRaw || !competition) {
    redirect("/admin?tab=fixtures&error=Fixture details are incomplete");
  }

  const kickoffAt = fromZonedTime(kickoffRaw, "Europe/London").toISOString();

  const { data: existingFixture } = await supabase
    .from("fixtures")
    .select("gameweek_id")
    .eq("id", fixtureId)
    .single();

  const { error } = await supabase
    .from("fixtures")
    .update({
      home_team: homeTeam,
      away_team: awayTeam,
      kickoff_at: kickoffAt,
      competition,
    })
    .eq("id", fixtureId);

  if (error) {
    redirect(
      `/admin?tab=fixtures&error=${encodeURIComponent(error.message)}`,
    );
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");

  const gameweekQuery = existingFixture?.gameweek_id
    ? `&gameweek=${existingFixture.gameweek_id}`
    : "";

  redirect(`/admin?tab=fixtures${gameweekQuery}&saved=1`);
}

export async function deleteFixture(formData: FormData) {
  const { supabase } = await requireAdmin();

  const fixtureId = String(formData.get("fixture_id"));

  if (!fixtureId) {
    redirect("/admin?tab=fixtures&error=Missing fixture");
  }

  const { data: existingFixture } = await supabase
    .from("fixtures")
    .select("gameweek_id")
    .eq("id", fixtureId)
    .single();

  const { count } = await supabase
    .from("predictions")
    .select("id", { count: "exact", head: true })
    .eq("fixture_id", fixtureId);

  const gameweekQuery = existingFixture?.gameweek_id
    ? `&gameweek=${existingFixture.gameweek_id}`
    : "";

  if ((count ?? 0) > 0) {
    redirect(
      `/admin?tab=fixtures${gameweekQuery}&error=${encodeURIComponent(
        "Cannot delete fixture because predictions already exist",
      )}`,
    );
  }

  const { error } = await supabase.from("fixtures").delete().eq("id", fixtureId);

  if (error) {
    redirect(
      `/admin?tab=fixtures${gameweekQuery}&error=${encodeURIComponent(
        error.message,
      )}`,
    );
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");

  redirect(`/admin?tab=fixtures${gameweekQuery}&saved=1`);
}

export async function disableUser(formData: FormData) {
  const { supabase, user } = await requireAdmin();

  const userId = String(formData.get("user_id"));

  if (!userId) {
    redirect("/admin?tab=users&error=Missing user");
  }

  if (userId === user.id) {
    redirect(
      `/admin?tab=users&error=${encodeURIComponent(
        "You cannot disable your own account",
      )}`,
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      status: "disabled",
    })
    .eq("id", userId);

  if (error) {
    redirect(`/admin?tab=users&error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/leaderboard");

  redirect("/admin?tab=users&saved=1");
}

export async function enableUser(formData: FormData) {
  const { supabase } = await requireAdmin();

  const userId = String(formData.get("user_id"));

  if (!userId) {
    redirect("/admin?tab=users&error=Missing user");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      status: "approved",
    })
    .eq("id", userId);

  if (error) {
    redirect(`/admin?tab=users&error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/leaderboard");

  redirect("/admin?tab=users&saved=1");
}

export async function approveUser(formData: FormData) {
  const { supabase } = await requireAdmin();

  const userId = String(formData.get("user_id"));

  if (!userId) {
    redirect("/admin?tab=users&error=Missing user");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      status: "approved",
    })
    .eq("id", userId);

  if (error) {
    redirect(`/admin?tab=users&error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/leaderboard");

  redirect("/admin?tab=users&saved=1");
}

export async function rejectUser(formData: FormData) {
  const { supabase, user } = await requireAdmin();

  const userId = String(formData.get("user_id"));

  if (!userId) {
    redirect("/admin?tab=users&error=Missing user");
  }

  if (userId === user.id) {
    redirect(
      `/admin?tab=users&error=${encodeURIComponent(
        "You cannot reject your own account",
      )}`,
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      status: "rejected",
    })
    .eq("id", userId);

  if (error) {
    redirect(`/admin?tab=users&error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin");

  redirect("/admin?tab=users&saved=1");
}

export async function updateFixtureResults(formData: FormData) {
  const { supabase } = await requireAdmin();

  const fixtureIds = formData.getAll("fixture_id").map(String);
  const updatedSeasonIds = new Set<string>();
  let savedAnyFixture = false;

  for (const fixtureId of fixtureIds) {
    const homeScoreRaw = formData.get(`home_score_${fixtureId}`);
    const awayScoreRaw = formData.get(`away_score_${fixtureId}`);

    const homeScoreText = String(homeScoreRaw ?? "").trim();
    const awayScoreText = String(awayScoreRaw ?? "").trim();

    if (!homeScoreText && !awayScoreText) {
      continue;
    }

    const homeScore = Number(homeScoreText);
    const awayScore = Number(awayScoreText);

    if (
      !Number.isInteger(homeScore) ||
      !Number.isInteger(awayScore) ||
      homeScore < 0 ||
      awayScore < 0
    ) {
      redirect(
        `/admin?tab=results&error=${encodeURIComponent(
          "Scores must be whole numbers",
        )}`,
      );
    }

    const { error } = await supabase
      .from("fixtures")
      .update({
        home_score: homeScore,
        away_score: awayScore,
        status: "completed",
      })
      .eq("id", fixtureId);

    if (error) {
      redirect(
        `/admin?tab=results&error=${encodeURIComponent(error.message)}`,
      );
    }

    const seasonId = await scoreFixture(fixtureId);

    if (seasonId) {
      updatedSeasonIds.add(seasonId);
    }

    savedAnyFixture = true;
  }

  if (!savedAnyFixture) {
    redirect("/admin?tab=results&error=Add at least one result");
  }

  for (const seasonId of updatedSeasonIds) {
    await recalculateLeaderboard(seasonId);
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/leaderboard");

  redirect("/admin?tab=results&saved=1");
}