"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getKickoffIso } from "@/utils/fixtures";
import { getActiveSeason } from "@/utils/seasons";
import { upsertActivityNotification } from "@/utils/activity";

type LeaderboardPredictionRow = {
  user_id: string;
  points: number | null;
  is_exact_score: boolean;
  is_correct_result: boolean;
};

type FixtureGameweekLookupRow = {
  gameweek_id: string;
};

type ActivityGameweekRow = {
  id: string;
  season_id: string;
  gameweek_number: number;
  name: string | null;
};

type ActivityFixtureRow = {
  id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
};

type WeeklyPredictionRow = {
  user_id: string;
  points: number | null;
  profiles:
    | {
        display_name: string;
      }
    | {
        display_name: string;
      }[]
    | null;
};

type LeaderboardMovementRow = {
  user_id: string;
  rank: number | null;
  previous_rank: number | null;
  total_points: number;
  profiles:
    | {
        display_name: string;
      }
    | {
        display_name: string;
      }[]
    | null;
};

type NextPickerGameweekRow = {
  id: string;
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

type ExistingGameweekRow = {
  gameweek_number: number;
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

export async function recalculateActiveSeasonLeaderboard() {
  const { supabase } = await requireAdmin();
  const { data: activeSeason } = await getActiveSeason(supabase, "id");

  if (!activeSeason) {
    redirect(
      `/admin?tab=maintenance&error=${encodeURIComponent(
        "No active season found",
      )}`,
    );
  }

  await recalculateLeaderboard(activeSeason.id);

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/leaderboard");

  redirect("/admin?tab=maintenance&saved=1");
}

export async function rescoreActiveSeasonAndRecalculateLeaderboard() {
  const { supabase } = await requireAdmin();
  const { data: activeSeason } = await getActiveSeason(supabase, "id");

  if (!activeSeason) {
    redirect(
      `/admin?tab=maintenance&error=${encodeURIComponent(
        "No active season found",
      )}`,
    );
  }

  const { data: completedFixtures, error } = await supabase
    .from("fixtures")
    .select(
      `
      id,
      gameweeks!inner (
        season_id
      )
    `,
    )
    .eq("status", "completed")
    .eq("gameweeks.season_id", activeSeason.id);

  if (error) {
    redirect(
      `/admin?tab=maintenance&error=${encodeURIComponent(error.message)}`,
    );
  }

  for (const fixture of (completedFixtures as { id: string }[] | null) ?? []) {
    await scoreFixture(fixture.id);
  }

  await recalculateLeaderboard(activeSeason.id);

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/predictions");
  revalidatePath("/leaderboard");

  redirect("/admin?tab=maintenance&saved=1");
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

    const kickoffAt = getKickoffIso(kickoffRaw);

    fixturesToCreate.push({
      home_team: homeTeam,
      away_team: awayTeam,
      kickoff_at: kickoffAt,
      competition,
      created_by: user.id,
    });
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

  if (fixturesToCreate.length > 0) {
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
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");

  redirect(`/admin?tab=fixtures&gameweek=${gameweek.id}&saved=1`);
}

export async function generateMissingGameweeks(formData: FormData) {
  const { supabase } = await requireAdmin();

  const seasonId = String(formData.get("season_id") ?? "");
  const targetCount = Number(formData.get("target_count"));

  if (!seasonId || !Number.isInteger(targetCount) || targetCount < 1) {
    redirect(
      `/admin?tab=create&error=${encodeURIComponent(
        "Invalid season setup details",
      )}`,
    );
  }

  if (targetCount > 60) {
    redirect(
      `/admin?tab=create&error=${encodeURIComponent(
        "Maximum gameweek count is 60",
      )}`,
    );
  }

  const { data: existingGameweeks, error: existingError } = await supabase
    .from("gameweeks")
    .select("gameweek_number")
    .eq("season_id", seasonId);

  if (existingError) {
    redirect(
      `/admin?tab=create&error=${encodeURIComponent(existingError.message)}`,
    );
  }

  const existingNumbers = new Set(
    ((existingGameweeks as ExistingGameweekRow[] | null) ?? []).map(
      (gameweek) => gameweek.gameweek_number,
    ),
  );

  const gameweeksToCreate = [];

  for (let gameweekNumber = 1; gameweekNumber <= targetCount; gameweekNumber++) {
    if (!existingNumbers.has(gameweekNumber)) {
      gameweeksToCreate.push({
        season_id: seasonId,
        gameweek_number: gameweekNumber,
        name: `Gameweek ${gameweekNumber}`,
      });
    }
  }

  if (gameweeksToCreate.length > 0) {
    const { error: insertError } = await supabase
      .from("gameweeks")
      .insert(gameweeksToCreate);

    if (insertError) {
      redirect(
        `/admin?tab=create&error=${encodeURIComponent(insertError.message)}`,
      );
    }
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");

  redirect("/admin?tab=create&saved=1");
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

  const kickoffAt = getKickoffIso(kickoffRaw);

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

  const kickoffAt = getKickoffIso(kickoffRaw);

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

function getProfileDisplayName(
  profiles:
    | {
        display_name: string;
      }
    | {
        display_name: string;
      }[]
    | null,
) {
  if (Array.isArray(profiles)) {
    return profiles[0]?.display_name ?? "Unknown player";
  }

  return profiles?.display_name ?? "Unknown player";
}

type SeasonStatus = "draft" | "active" | "archived";

function getSeasonRedirectUrl({
  saved,
  error,
}: {
  saved?: string;
  error?: string;
}) {
  const params = new URLSearchParams({
    tab: "create",
  });

  if (saved) {
    params.set("saved", saved);
  }

  if (error) {
    params.set("error", error);
  }

  return `/admin?${params.toString()}`;
}

function getValidSeasonType(value: string) {
  if (value === "standard" || value === "test" || value === "world_cup") {
    return value;
  }

  return "standard";
}

async function createGameweeksForSeason({
  supabase,
  seasonId,
  targetCount,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  seasonId: string;
  targetCount: number;
}) {
  if (!Number.isInteger(targetCount) || targetCount < 1) {
    return;
  }

  if (targetCount > 60) {
    throw new Error("Maximum gameweek count is 60");
  }

  const gameweeksToCreate = Array.from({ length: targetCount }, (_, index) => {
    const gameweekNumber = index + 1;

    return {
      season_id: seasonId,
      gameweek_number: gameweekNumber,
      name: `Gameweek ${gameweekNumber}`,
    };
  });

  const { error } = await supabase.from("gameweeks").insert(gameweeksToCreate);

  if (error) {
    throw new Error(error.message);
  }
}

export async function createSeason(formData: FormData) {
  const { supabase, user } = await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const seasonType = getValidSeasonType(
    String(formData.get("season_type") ?? "standard"),
  );
  const status = String(formData.get("status") ?? "draft") as SeasonStatus;
  const gameweekCount = Number(formData.get("gameweek_count") ?? 0);

  const autoAssignPickers =
  String(formData.get("auto_assign_pickers") ?? "") === "on";

  if (!name) {
    redirect(
      getSeasonRedirectUrl({
        error: "Season name is required",
      }),
    );
  }

  if (status !== "draft" && status !== "active") {
    redirect(
      getSeasonRedirectUrl({
        error: "New seasons must be created as draft or active",
      }),
    );
  }

  if (
    gameweekCount &&
    (!Number.isInteger(gameweekCount) || gameweekCount < 1 || gameweekCount > 60)
  ) {
    redirect(
      getSeasonRedirectUrl({
        error: "Gameweek count must be between 1 and 60",
      }),
    );
  }

  if (status === "active") {
    const { error: archiveActiveError } = await supabase
      .from("seasons")
      .update({
        status: "archived",
        archived_at: new Date().toISOString(),
        archived_by: user.id,
      })
      .eq("status", "active");

    if (archiveActiveError) {
      redirect(
        getSeasonRedirectUrl({
          error: archiveActiveError.message,
        }),
      );
    }
  }

  const { data: season, error } = await supabase
    .from("seasons")
    .insert({
      name,
      description: description || null,
      season_type: seasonType,
      status,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !season) {
    redirect(
      getSeasonRedirectUrl({
        error: error?.message ?? "Could not create season",
      }),
    );
  }

  try {
    if (gameweekCount > 0) {
      await createGameweeksForSeason({
        supabase,
        seasonId: season.id,
        targetCount: gameweekCount,
      });
    }
    if (autoAssignPickers) {
      await autoAssignPickersForSeason({
        supabase,
        seasonId: season.id,
      });
    }
  } catch (createGameweeksError) {
    redirect(
      getSeasonRedirectUrl({
        error:
          createGameweeksError instanceof Error
            ? createGameweeksError.message
            : "Season created, but gameweeks could not be generated",
      }),
    );
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/predictions");
  revalidatePath("/pick-fixtures");
  revalidatePath("/leaderboard");

  redirect(
    getSeasonRedirectUrl({
      saved: "1",
    }),
  );
}

export async function activateSeason(formData: FormData) {
  const { supabase, user } = await requireAdmin();

  const seasonId = String(formData.get("season_id") ?? "");

  if (!seasonId) {
    redirect(
      getSeasonRedirectUrl({
        error: "No season selected",
      }),
    );
  }

  const { data: targetSeason, error: targetSeasonError } = await supabase
    .from("seasons")
    .select("id, status")
    .eq("id", seasonId)
    .single();

  if (targetSeasonError || !targetSeason) {
    redirect(
      getSeasonRedirectUrl({
        error: targetSeasonError?.message ?? "Could not find season",
      }),
    );
  }

  if (targetSeason.status === "archived") {
    redirect(
      getSeasonRedirectUrl({
        error: "Archived seasons cannot be reactivated. Create a new season instead.",
      }),
    );
  }

  const { error: archiveActiveError } = await supabase
    .from("seasons")
    .update({
      status: "archived",
      archived_at: new Date().toISOString(),
      archived_by: user.id,
    })
    .eq("status", "active")
    .neq("id", seasonId);

  if (archiveActiveError) {
    redirect(
      getSeasonRedirectUrl({
        error: archiveActiveError.message,
      }),
    );
  }

  const { error: activateError } = await supabase
    .from("seasons")
    .update({
      status: "active",
      archived_at: null,
      archived_by: null,
    })
    .eq("id", seasonId);

  if (activateError) {
    redirect(
      getSeasonRedirectUrl({
        error: activateError.message,
      }),
    );
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/predictions");
  revalidatePath("/pick-fixtures");
  revalidatePath("/leaderboard");

  redirect(
    getSeasonRedirectUrl({
      saved: "1",
    }),
  );
}

export async function restoreSeasonToDraft(formData: FormData) {
  const { supabase } = await requireAdmin();

  const seasonId = String(formData.get("season_id") ?? "");

  if (!seasonId) {
    redirect(
      getSeasonRedirectUrl({
        error: "No season selected",
      }),
    );
  }

  const { error } = await supabase
    .from("seasons")
    .update({
      status: "draft",
      archived_at: null,
      archived_by: null,
    })
    .eq("id", seasonId)
    .eq("status", "archived");

  if (error) {
    redirect(
      getSeasonRedirectUrl({
        error: error.message,
      }),
    );
  }

  revalidatePath("/admin");

  redirect(
    getSeasonRedirectUrl({
      saved: "1",
    }),
  );
}

export async function saveGameweekPickerAssignments(formData: FormData) {
  const { supabase } = await requireAdmin();

  const gameweekIds = formData.getAll("gameweek_id").map(String);

  if (gameweekIds.length === 0) {
    redirect(
      getSeasonRedirectUrl({
        error: "No gameweeks found to update",
      }),
    );
  }

  for (const gameweekId of gameweekIds) {
    const fixturePickerIdRaw = String(
      formData.get(`fixture_picker_id_${gameweekId}`) ?? "",
    );

    const fixturePickerId =
      fixturePickerIdRaw && fixturePickerIdRaw !== "unassigned"
        ? fixturePickerIdRaw
        : null;

    const { error } = await supabase
      .from("gameweeks")
      .update({
        fixture_picker_id: fixturePickerId,
      })
      .eq("id", gameweekId);

    if (error) {
      redirect(
        getSeasonRedirectUrl({
          error: error.message,
        }),
      );
    }
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/pick-fixtures");

  redirect(
    getSeasonRedirectUrl({
      saved: "1",
    }),
  );
}

export async function autoAssignAllGameweekPickers(formData: FormData) {
  const { supabase } = await requireAdmin();

  const seasonId = String(formData.get("season_id") ?? "");

  if (!seasonId) {
    redirect(
      getSeasonRedirectUrl({
        error: "No season selected",
      }),
    );
  }

  try {
    await autoAssignPickersForSeason({
      supabase,
      seasonId,
    });
  } catch (error) {
    redirect(
      getSeasonRedirectUrl({
        error:
          error instanceof Error
            ? error.message
            : "Could not auto-assign fixture pickers",
      }),
    );
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/pick-fixtures");

  redirect(
    getSeasonRedirectUrl({
      saved: "1",
    }),
  );
}

export async function autoAssignFutureGameweekPickers(formData: FormData) {
  const { supabase } = await requireAdmin();

  const seasonId = String(formData.get("season_id") ?? "");

  if (!seasonId) {
    redirect(
      getSeasonRedirectUrl({
        error: "No season selected",
      }),
    );
  }

  try {
    await autoAssignPickersForSeason({
      supabase,
      seasonId,
      onlyGameweeksWithoutFixtures: true,
    });
  } catch (error) {
    redirect(
      getSeasonRedirectUrl({
        error:
          error instanceof Error
            ? error.message
            : "Could not auto-assign future fixture pickers",
      }),
    );
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/pick-fixtures");

  redirect(
    getSeasonRedirectUrl({
      saved: "1",
    }),
  );
}

export async function updateSeasonArchiveVisibility(formData: FormData) {
  const { supabase } = await requireAdmin();

  const seasonId = String(formData.get("season_id") ?? "");
  const showInArchive =
    String(formData.get("show_in_archive") ?? "") === "on";

  if (!seasonId) {
    redirect(
      getSeasonRedirectUrl({
        error: "No season selected",
      }),
    );
  }

  const { error } = await supabase
    .from("seasons")
    .update({
      show_in_archive: showInArchive,
    })
    .eq("id", seasonId);

  if (error) {
    redirect(
      getSeasonRedirectUrl({
        error: error.message,
      }),
    );
  }

  revalidatePath("/admin");
  revalidatePath("/leaderboard");

  redirect(
    getSeasonRedirectUrl({
      saved: "1",
    }),
  );
}

export async function deleteSeason(formData: FormData) {
  const { supabase } = await requireAdmin();

  const seasonId = String(formData.get("season_id") ?? "");
  const confirmText = String(formData.get("confirm_text") ?? "").trim();

  if (!seasonId) {
    redirect(
      getSeasonRedirectUrl({
        error: "No season selected",
      }),
    );
  }

  if (confirmText !== "DELETE") {
    redirect(
      getSeasonRedirectUrl({
        error: "Type DELETE to confirm season deletion",
      }),
    );
  }

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, name, status, season_type, show_in_archive")
    .eq("id", seasonId)
    .single();

  if (seasonError || !season) {
    redirect(
      getSeasonRedirectUrl({
        error: seasonError?.message ?? "Could not find season",
      }),
    );
  }

  if (season.status === "active") {
    redirect(
      getSeasonRedirectUrl({
        error: "You cannot delete the active season. Archive it first.",
      }),
    );
  }

  const canDelete =
    season.status === "draft" ||
    season.season_type === "test" ||
    season.season_type === "world_cup" ||
    season.show_in_archive === false;

  if (!canDelete) {
    redirect(
      getSeasonRedirectUrl({
        error:
          "Only draft, test, cup, or hidden archived seasons can be deleted.",
      }),
    );
  }

  const adminSupabase = createAdminClient();

  const { data: gameweeks } = await adminSupabase
    .from("gameweeks")
    .select("id")
    .eq("season_id", seasonId);

  const gameweekIds =
    (gameweeks as { id: string }[] | null)?.map((gameweek) => gameweek.id) ??
    [];

  const { data: fixtures } =
    gameweekIds.length > 0
      ? await adminSupabase
          .from("fixtures")
          .select("id")
          .in("gameweek_id", gameweekIds)
      : { data: null };

  const fixtureIds =
    (fixtures as { id: string }[] | null)?.map((fixture) => fixture.id) ?? [];

  if (fixtureIds.length > 0) {
    const { error: jokerDeleteError } = await adminSupabase
      .from("joker_usage")
      .delete()
      .in("fixture_id", fixtureIds);

    if (jokerDeleteError) {
      redirect(
        getSeasonRedirectUrl({
          error: jokerDeleteError.message,
        }),
      );
    }

    const { error: predictionDeleteError } = await adminSupabase
      .from("predictions")
      .delete()
      .in("fixture_id", fixtureIds);

    if (predictionDeleteError) {
      redirect(
        getSeasonRedirectUrl({
          error: predictionDeleteError.message,
        }),
      );
    }

    const { error: fixtureDeleteError } = await adminSupabase
      .from("fixtures")
      .delete()
      .in("id", fixtureIds);

    if (fixtureDeleteError) {
      redirect(
        getSeasonRedirectUrl({
          error: fixtureDeleteError.message,
        }),
      );
    }
  }

  if (gameweekIds.length > 0) {
    const { error: gameweekDeleteError } = await adminSupabase
      .from("gameweeks")
      .delete()
      .in("id", gameweekIds);

    if (gameweekDeleteError) {
      redirect(
        getSeasonRedirectUrl({
          error: gameweekDeleteError.message,
        }),
      );
    }
  }

  const { error: pickerOrderDeleteError } = await adminSupabase
    .from("fixture_picker_order")
    .delete()
    .eq("season_id", seasonId);

  if (pickerOrderDeleteError) {
    redirect(
      getSeasonRedirectUrl({
        error: pickerOrderDeleteError.message,
      }),
    );
  }

  const { error: leaderboardDeleteError } = await adminSupabase
    .from("leaderboard_entries")
    .delete()
    .eq("season_id", seasonId);

  if (leaderboardDeleteError) {
    redirect(
      getSeasonRedirectUrl({
        error: leaderboardDeleteError.message,
      }),
    );
  }

  const { error: seasonDeleteError } = await adminSupabase
    .from("seasons")
    .delete()
    .eq("id", seasonId);

  if (seasonDeleteError) {
    redirect(
      getSeasonRedirectUrl({
        error: seasonDeleteError.message,
      }),
    );
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/predictions");
  revalidatePath("/pick-fixtures");
  revalidatePath("/leaderboard");

  redirect(
    getSeasonRedirectUrl({
      saved: "1",
    }),
  );
}

export async function archiveSeason(formData: FormData) {
  const { supabase, user } = await requireAdmin();

  const seasonId = String(formData.get("season_id") ?? "");

  if (!seasonId) {
    redirect(
      getSeasonRedirectUrl({
        error: "No season selected",
      }),
    );
  }

  const { error } = await supabase
    .from("seasons")
    .update({
      status: "archived",
      archived_at: new Date().toISOString(),
      archived_by: user.id,
    })
    .eq("id", seasonId);

  if (error) {
    redirect(
      getSeasonRedirectUrl({
        error: error.message,
      }),
    );
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/predictions");
  revalidatePath("/pick-fixtures");
  revalidatePath("/leaderboard");

  redirect(
    getSeasonRedirectUrl({
      saved: "1",
    }),
  );
}

async function getApprovedPlayerIds({
  supabase,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const { data: approvedPlayers, error } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("status", "approved")
    .order("display_name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (
    approvedPlayers as
      | {
          id: string;
          display_name: string;
        }[]
      | null
  ) ?? [];
}

async function autoAssignPickersForSeason({
  supabase,
  seasonId,
  onlyGameweeksWithoutFixtures = false,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  seasonId: string;
  onlyGameweeksWithoutFixtures?: boolean;
}) {
  const approvedPlayers = await getApprovedPlayerIds({ supabase });

  if (approvedPlayers.length === 0) {
    throw new Error("No approved users found to assign as fixture pickers");
  }

  const { data: gameweeks, error: gameweeksError } = await supabase
    .from("gameweeks")
    .select(
      `
      id,
      gameweek_number,
      fixtures (
        id
      )
    `,
    )
    .eq("season_id", seasonId)
    .order("gameweek_number", { ascending: true });

  if (gameweeksError) {
    throw new Error(gameweeksError.message);
  }

  const gameweekList =
    (gameweeks as
      | {
          id: string;
          gameweek_number: number;
          fixtures:
            | {
                id: string;
              }[]
            | null;
        }[]
      | null) ?? [];

  const assignableGameweeks = onlyGameweeksWithoutFixtures
    ? gameweekList.filter(
        (gameweek) => (gameweek.fixtures ?? []).length === 0,
      )
    : gameweekList;

  const updates = assignableGameweeks.map((gameweek, index) => ({
    id: gameweek.id,
    fixture_picker_id: approvedPlayers[index % approvedPlayers.length].id,
  }));

  for (const update of updates) {
    const { error } = await supabase
      .from("gameweeks")
      .update({
        fixture_picker_id: update.fixture_picker_id,
      })
      .eq("id", update.id);

    if (error) {
      throw new Error(error.message);
    }
  }
}

function formatGameweekName(gameweek: {
  gameweek_number: number;
  name: string | null;
}) {
  return gameweek.name || `Gameweek ${gameweek.gameweek_number}`;
}

function formatPlayerList(names: string[]) {
  if (names.length === 0) {
    return "";
  }

  if (names.length === 1) {
    return names[0];
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }

  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function formatMovementText({
  name,
  movement,
}: {
  name: string;
  movement: number;
}) {
  if (movement > 0) {
    return `${name} up ${movement} position${movement === 1 ? "" : "s"}`;
  }

  const fall = Math.abs(movement);

  return `${name} down ${fall} position${fall === 1 ? "" : "s"}`;
}

async function getGameweekFixtureIds({
  supabase,
  gameweekId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  gameweekId: string;
}) {
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("id, home_team, away_team, kickoff_at, status, home_score, away_score")
    .eq("gameweek_id", gameweekId)
    .order("kickoff_at", { ascending: true });

  return (fixtures as ActivityFixtureRow[] | null) ?? [];
}

function isGameweekComplete(fixtures: ActivityFixtureRow[]) {
  return (
    fixtures.length > 0 &&
    fixtures.every((fixture) =>
      ["completed", "postponed", "void"].includes(fixture.status),
    )
  );
}

async function upsertGameweekCompleteActivity({
  supabase,
  gameweekId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  gameweekId: string;
}) {
  const { data: gameweek } = await supabase
    .from("gameweeks")
    .select("id, season_id, gameweek_number, name")
    .eq("id", gameweekId)
    .single();

  const typedGameweek = gameweek as ActivityGameweekRow | null;

  if (!typedGameweek) {
    return;
  }

  const fixtures = await getGameweekFixtureIds({
    supabase,
    gameweekId,
  });

  if (!isGameweekComplete(fixtures)) {
    return;
  }

  const fixtureIds = fixtures.map((fixture) => fixture.id);

  const { data: predictions } =
    fixtureIds.length > 0
      ? await supabase
          .from("predictions")
          .select(
            `
            user_id,
            points,
            profiles (
              display_name
            )
          `,
          )
          .in("fixture_id", fixtureIds)
      : { data: null };

  const weeklyTotals = new Map<
    string,
    {
      userId: string;
      displayName: string;
      points: number;
    }
  >();

  for (const prediction of (predictions as WeeklyPredictionRow[] | null) ??
    []) {
    const current =
      weeklyTotals.get(prediction.user_id) ??
      {
        userId: prediction.user_id,
        displayName: getProfileDisplayName(prediction.profiles),
        points: 0,
      };

    current.points += prediction.points ?? 0;

    weeklyTotals.set(prediction.user_id, current);
  }

  const weeklyRankedRaw = [...weeklyTotals.values()].sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }

    return a.displayName.localeCompare(b.displayName);
  });

  const weeklyLeaderboard: {
    rank: number;
    name: string;
    points: number;
  }[] = [];

  let currentRank = 0;
  let previousPoints: number | null = null;

  weeklyRankedRaw.forEach((entry, index) => {
    if (previousPoints === null || entry.points !== previousPoints) {
      currentRank = index + 1;
    }

    weeklyLeaderboard.push({
      rank: currentRank,
      name: entry.displayName,
      points: entry.points,
    });

    previousPoints = entry.points;
  });

  const topWeeklyPoints = weeklyLeaderboard[0]?.points ?? 0;

  const weeklyWinners = weeklyLeaderboard
    .filter((entry) => entry.points === topWeeklyPoints && topWeeklyPoints > 0)
    .map((entry) => ({
      name: entry.name,
      points: entry.points,
    }));

  const { data: leaderboardRows } = await supabase
    .from("leaderboard_entries")
    .select(
      `
      user_id,
      rank,
      previous_rank,
      total_points,
      profiles (
        display_name
      )
    `,
    )
    .eq("season_id", typedGameweek.season_id)
    .order("rank", { ascending: true });

  const movementRows =
    (leaderboardRows as LeaderboardMovementRow[] | null) ?? [];

  const movements = movementRows
    .filter((entry) => entry.rank !== null && entry.previous_rank !== null)
    .map((entry) => ({
      name: getProfileDisplayName(entry.profiles),
      movement: (entry.previous_rank ?? 0) - (entry.rank ?? 0),
    }))
    .filter((entry) => entry.movement !== 0);

  const maxRise =
    movements.filter((entry) => entry.movement > 0).length > 0
      ? Math.max(
          ...movements
            .filter((entry) => entry.movement > 0)
            .map((entry) => entry.movement),
        )
      : 0;

  const maxFall =
    movements.filter((entry) => entry.movement < 0).length > 0
      ? Math.min(
          ...movements
            .filter((entry) => entry.movement < 0)
            .map((entry) => entry.movement),
        )
      : 0;

  const biggestRisers = movements
    .filter((entry) => entry.movement === maxRise && maxRise > 0)
    .map((entry) => ({
      name: entry.name,
      movement: entry.movement,
    }));

  const biggestFallers = movements
    .filter((entry) => entry.movement === maxFall && maxFall < 0)
    .map((entry) => ({
      name: entry.name,
      movement: entry.movement,
    }));

  const gameweekName = formatGameweekName(typedGameweek);

  const fixtureResults = fixtures.map((fixture) => ({
    homeTeam: fixture.home_team,
    awayTeam: fixture.away_team,
    homeScore: fixture.home_score,
    awayScore: fixture.away_score,
    status: fixture.status,
  }));

  const winnerNames = weeklyWinners.map((winner) => winner.name);

  const winnerText =
    weeklyWinners.length > 0
      ? `Weekly winner${weeklyWinners.length === 1 ? "" : "s"}: ${formatPlayerList(
          winnerNames,
        )} with ${topWeeklyPoints} point${topWeeklyPoints === 1 ? "" : "s"}.`
      : "No weekly winner because no points were scored.";

  const riserText =
    biggestRisers.length > 0
      ? `Biggest riser${biggestRisers.length === 1 ? "" : "s"}: ${formatPlayerList(
          biggestRisers.map((riser) =>
            formatMovementText({
              name: riser.name,
              movement: riser.movement,
            }),
          ),
        )}.`
      : "";

  const fallerText =
    biggestFallers.length > 0
      ? `Biggest faller${biggestFallers.length === 1 ? "" : "s"}: ${formatPlayerList(
          biggestFallers.map((faller) =>
            formatMovementText({
              name: faller.name,
              movement: faller.movement,
            }),
          ),
        )}.`
      : "";

  const movementText =
    riserText || fallerText
      ? [riserText, fallerText].filter(Boolean).join(" ")
      : "No leaderboard movement this week.";

  await upsertActivityNotification({
    eventKey: `gameweek_complete:${gameweekId}`,
    type: "results_available",
    title: `${gameweekName} complete`,
    body: `${gameweekName} is complete. ${winnerText} ${movementText}`,
    seasonId: typedGameweek.season_id,
    gameweekId,
    metadata: {
      gameweekId,
      gameweekName,
      fixtures: fixtureResults,
      weeklyLeaderboard,
      weeklyWinners,
      biggestRisers,
      biggestFallers,
    },
  });
}

async function upsertNextPickerActivity({
  supabase,
  completedGameweekId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  completedGameweekId: string;
}) {
  const { data: completedGameweek } = await supabase
    .from("gameweeks")
    .select("season_id, gameweek_number")
    .eq("id", completedGameweekId)
    .single();

  if (!completedGameweek) {
    return;
  }

  const { data: nextGameweek } = await supabase
    .from("gameweeks")
    .select(
      `
      id,
      gameweek_number,
      name,
      fixture_picker_id,
      profiles (
        display_name
      )
    `,
    )
    .eq("season_id", completedGameweek.season_id)
    .eq("gameweek_number", completedGameweek.gameweek_number + 1)
    .maybeSingle();

  const typedNextGameweek = nextGameweek as NextPickerGameweekRow | null;

  if (!typedNextGameweek || !typedNextGameweek.fixture_picker_id) {
    return;
  }

  const pickerName = getProfileDisplayName(typedNextGameweek.profiles);
  const gameweekName = formatGameweekName(typedNextGameweek);

  await upsertActivityNotification({
    eventKey: `next_picker:${typedNextGameweek.id}`,
    type: "info",
    title: `${pickerName} is up next`,
    body: `${pickerName} is to pick fixtures for ${gameweekName}.`,
    seasonId: completedGameweek.season_id,
    gameweekId: typedNextGameweek.id,
    metadata: {
      gameweekId: typedNextGameweek.id,
      gameweekName,
      pickerName,
    },
  });
}

export async function updateFixtureResults(formData: FormData) {
  const { supabase } = await requireAdmin();

  const fixtureIds = formData.getAll("fixture_id").map(String);
  const updatedSeasonIds = new Set<string>();
  const updatedGameweekIds = new Set<string>();
  let savedAnyFixture = false;

  for (const fixtureId of fixtureIds) {
    const homeScoreRaw = formData.get(`home_score_${fixtureId}`);
    const awayScoreRaw = formData.get(`away_score_${fixtureId}`);

    const homeScoreText = String(homeScoreRaw ?? "").trim();
    const awayScoreText = String(awayScoreRaw ?? "").trim();

    if (!homeScoreText && !awayScoreText) {
      continue;
    }

    if (!homeScoreText || !awayScoreText) {
      redirect(
        `/admin?tab=results&error=${encodeURIComponent(
          "Enter both home and away scores for each result",
        )}`,
      );
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

    const { data: fixtureLookup } = await supabase
      .from("fixtures")
      .select("gameweek_id")
      .eq("id", fixtureId)
      .single();

    const typedFixtureLookup =
      fixtureLookup as FixtureGameweekLookupRow | null;

    if (typedFixtureLookup?.gameweek_id) {
      updatedGameweekIds.add(typedFixtureLookup.gameweek_id);
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

  for (const gameweekId of updatedGameweekIds) {
    await upsertGameweekCompleteActivity({
      supabase,
      gameweekId,
    });

    await upsertNextPickerActivity({
      supabase,
      completedGameweekId: gameweekId,
    });
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/predictions");
  revalidatePath("/leaderboard");

  redirect("/admin?tab=results&saved=1");
}
