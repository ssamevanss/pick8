"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getKickoffIso } from "@/utils/fixtures";
import { getActiveSeason } from "@/utils/seasons";
import { upsertActivityNotification } from "@/utils/activity";
import { upsertFixturesPickedActivity } from "@/utils/fixture-activity";
import {
  sendPickerUpNextEmail,
  sendPredictionsOpenEmails,
} from "@/utils/email-notifications";
import { getFixtureSelectionStatus } from "@/utils/fixture-selection";
import { generateLeagueFactNotifications } from "@/utils/league-facts";
import {
  canBrowseOtherCompetitions,
  getFootballDataCompetitionOption,
} from "@/utils/football-competitions";
import {
  buildLocalFixtureFromExternal,
  getExternalFixtureGroupKey,
  mapExternalStatusToFixtureStatus,
  type ExternalFixtureRow,
} from "@/utils/external-fixtures";
import {
  buildFixtureGroupTimings,
  buildFixtureTimingWindow,
  getSpecialFixtureCutoff,
  isKickoffBeforeSpecialFixtureCutoff,
  isKickoffOutsideTimingWindow,
} from "@/utils/fixture-timing-window";
import {
  calculatePredictionPoints,
} from "@/utils/provisional-scoring";
import { upsertGroupedUserNotification } from "@/utils/user-notifications";

type SupabaseLikeClient =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createAdminClient>;

type LeaderboardPredictionRow = {
  user_id: string;
  points: number | null;
  is_exact_score: boolean;
  is_correct_result: boolean;
};

type FixtureGameweekLookupRow = {
  gameweek_id: string;
};

type AdminGameweekSeasonRow = {
  id: string;
  season_id: string;
};

type ActiveSeasonExternalConfig = {
  id: string;
  base_provider: string | null;
  base_competition_code: string | null;
  base_competition_name: string | null;
};

type FixtureKickoffRow = {
  id: string;
  kickoff_at: string;
};

type ExternalGroupTimingRow = {
  external_matchday: number | null;
  external_stage: string | null;
  kickoff_at: string;
};

async function getAdminGameweekTimingWindow({
  supabase,
  gameweekId,
  baseCompetitionCode,
}: {
  supabase: SupabaseLikeClient;
  gameweekId: string;
  baseCompetitionCode: string | null;
}) {
  const { data: selectedFixtures } = await supabase
    .from("fixtures")
    .select("id, kickoff_at")
    .eq("gameweek_id", gameweekId)
    .order("kickoff_at", { ascending: true });

  const selectedFixtureKickoffs = (
    (selectedFixtures as FixtureKickoffRow[] | null) ?? []
  ).map((fixture) => fixture.kickoff_at);

  if (!baseCompetitionCode) {
    return buildFixtureTimingWindow({
      selectedFixtureKickoffs,
      baseCompetitionKickoffs: [],
    });
  }

  const nowIso = new Date().toISOString();
  const { data: baseFixtures } = await supabase
    .from("external_fixtures")
    .select("external_matchday, external_stage, kickoff_at")
    .eq("provider", "football_data")
    .eq("external_competition_code", baseCompetitionCode)
    .in("status", ["TIMED", "SCHEDULED"])
    .gt("kickoff_at", nowIso)
    .order("kickoff_at", { ascending: true });

  const baseFixtureRows =
    (baseFixtures as
      | {
          external_matchday: number | null;
          external_stage: string | null;
          kickoff_at: string;
        }[]
      | null) ?? [];
  const firstBaseGroupKey = baseFixtureRows[0]
    ? getExternalFixtureGroupKey(baseFixtureRows[0])
    : null;
  const baseCompetitionKickoffs = firstBaseGroupKey
    ? baseFixtureRows
        .filter(
          (fixture) =>
            getExternalFixtureGroupKey(fixture) === firstBaseGroupKey,
        )
        .map((fixture) => fixture.kickoff_at)
    : [];

  return buildFixtureTimingWindow({
    selectedFixtureKickoffs,
    baseCompetitionKickoffs,
  });
}

type ActivityGameweekRow = {
  id: string;
  season_id: string;
  gameweek_number: number;
  name: string | null;
  is_double_gameweek: boolean | null;
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
        is_double_gameweek: boolean | null;
      }
    | {
        season_id: string;
        is_double_gameweek: boolean | null;
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
    .select("role, status")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin" || profile.status !== "approved") {
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

function getIsDoubleGameweekFromFixture(fixture: FixtureToScore) {
  if (Array.isArray(fixture.gameweeks)) {
    return Boolean(fixture.gameweeks[0]?.is_double_gameweek);
  }

  return Boolean(fixture.gameweeks?.is_double_gameweek);
}

function calculatePoints({
  predictionHome,
  predictionAway,
  actualHome,
  actualAway,
  usedJoker,
  isDoubleGameweek = false,
}: {
  predictionHome: number;
  predictionAway: number;
  actualHome: number;
  actualAway: number;
  usedJoker: boolean;
  isDoubleGameweek?: boolean;
}) {
  const score = calculatePredictionPoints({
    predictionHome,
    predictionAway,
    actualHome,
    actualAway,
    usedJoker,
    isDoubleGameweek,
  });

  return {
    points: score.points,
    isExactScore: score.isExactScore,
    isCorrectResult: score.isCorrectResult,
  };
}

export async function scoreFixture(
  fixtureId: string,
  supabaseOverride?: SupabaseLikeClient,
) {
  const supabase = supabaseOverride ?? (await createClient());

  const { data: fixture } = await supabase
    .from("fixtures")
    .select(
      `
      id,
      home_score,
      away_score,
      gameweeks (
        season_id,
        is_double_gameweek
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
    const isDoubleGameweek = getIsDoubleGameweekFromFixture(typedFixture);
    const usedJoker =
      !isDoubleGameweek &&
      jokerKeys.has(`${prediction.fixture_id}:${prediction.user_id}`);

    const scored = calculatePoints({
      predictionHome: prediction.home_score,
      predictionAway: prediction.away_score,
      actualHome: typedFixture.home_score,
      actualAway: typedFixture.away_score,
      usedJoker,
      isDoubleGameweek,
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

export async function recalculateLeaderboard(
  seasonId: string,
  supabaseOverride?: SupabaseLikeClient,
) {
  const supabase = supabaseOverride ?? (await createClient());

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

export async function createMaintenanceTestNotification() {
  const { user } = await requireAdmin();

  await upsertGroupedUserNotification({
    recipientUserId: user.id,
    actorUserId: "maintenance-test",
    actorName: "Maintenance",
    notificationType: "maintenance_test",
    targetType: "diagnostic",
    targetId: `admin:${user.id}`,
    title: "Test notification",
    bodySingular: () => "Maintenance created a test inbox notification.",
    bodyGrouped: () => "Maintenance created a test inbox notification.",
    metadata: {
      targetHref: "/dashboard",
      source: "admin-maintenance",
      createdBy: user.id,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/dashboard");

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

    await upsertFixturesPickedActivityIfNoPredictions({
      supabase,
      gameweekId: gameweek.id,
      actioningUserId: user.id,
    });
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

  if (!kickoffAt) {
    redirect(
      `/admin?tab=fixtures&gameweek=${gameweekId}&error=${encodeURIComponent(
        "Kickoff date/time is invalid",
      )}`,
    );
  }

  const { data: activeSeason } = await getActiveSeason(
    supabase,
    "base_competition_code, base_competition_name",
  );
  const activeSeasonCompetition = activeSeason as {
    base_competition_code: string | null;
    base_competition_name: string | null;
  } | null;
  const timingWindow = await getAdminGameweekTimingWindow({
    supabase,
    gameweekId,
    baseCompetitionCode: activeSeasonCompetition?.base_competition_code ?? null,
  });

  if (
    isKickoffOutsideTimingWindow({ kickoffAt, timingWindow }) &&
    formData.get("confirm_timing_override") !== "1"
  ) {
    redirect(
      `/admin?tab=fixtures&gameweek=${gameweekId}&error=${encodeURIComponent(
        "This fixture is outside the usual gameweek window. Tick \"Add it anyway\" to confirm.",
      )}`,
    );
  }

  const normalizedCompetition = competition.toLowerCase();
  const normalizedBaseCompetitionCode =
    activeSeasonCompetition?.base_competition_code?.toLowerCase() ?? null;
  const normalizedBaseCompetitionName =
    activeSeasonCompetition?.base_competition_name?.toLowerCase() ?? null;
  const isManualBaseCompetition =
    normalizedCompetition === normalizedBaseCompetitionCode ||
    normalizedCompetition === normalizedBaseCompetitionName;

  if (
    activeSeasonCompetition?.base_competition_code &&
    canBrowseOtherCompetitions(activeSeasonCompetition.base_competition_code) &&
    !isManualBaseCompetition
  ) {
    const { data: baseFixturesForCutoff } = await supabase
      .from("external_fixtures")
      .select("external_matchday, external_stage, kickoff_at")
      .eq("provider", "football_data")
      .eq(
        "external_competition_code",
        activeSeasonCompetition.base_competition_code,
      )
      .in("status", ["TIMED", "SCHEDULED"])
      .gt("kickoff_at", new Date().toISOString())
      .order("kickoff_at", { ascending: true });
    const specialFixtureCutoff = getSpecialFixtureCutoff({
      baseGroups: buildFixtureGroupTimings(
        (baseFixturesForCutoff as ExternalGroupTimingRow[] | null) ?? [],
      ),
      currentGroupKey: null,
    });

    if (
      !isKickoffBeforeSpecialFixtureCutoff({
        kickoffAt,
        cutoff: specialFixtureCutoff,
      })
    ) {
      redirect(
        `/admin?tab=fixtures&gameweek=${gameweekId}&error=${encodeURIComponent(
          "This special fixture is too close to the next base-league gameweek",
        )}`,
      );
    }
  }

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

  await upsertFixturesPickedActivityIfNoPredictions({
    supabase,
    gameweekId,
    actioningUserId: user.id,
  });

  revalidatePath("/admin");
  revalidatePath("/dashboard");

  redirect(`/admin?tab=fixtures&gameweek=${gameweekId}&saved=1`);
}

async function upsertFixturesPickedActivityIfNoPredictions({
  supabase,
  gameweekId,
  actioningUserId,
}: {
  supabase: SupabaseLikeClient;
  gameweekId: string;
  actioningUserId?: string | null;
}) {
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("id")
    .eq("gameweek_id", gameweekId);

  const fixtureIds =
    ((fixtures as { id: string }[] | null) ?? []).map((fixture) => fixture.id);

  if (fixtureIds.length === 0) {
    return;
  }

  const { data: existingPrediction } = await supabase
    .from("predictions")
    .select("fixture_id")
    .in("fixture_id", fixtureIds)
    .limit(1)
    .maybeSingle();

  if (!existingPrediction) {
    await upsertFixturesPickedActivity({
      supabase,
      gameweekId,
      actioningUserId,
    });
    return;
  }

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
}

export async function addExternalFixturesToGameweek(formData: FormData) {
  const { supabase, user } = await requireAdmin();

  const gameweekId = String(formData.get("gameweek_id") ?? "");
  const selectedCompetitionCode = String(
    formData.get("competition_code") ?? "",
  ).trim();
  const selectedExternalIds = formData
    .getAll("external_fixture_id")
    .map((value) => String(value))
    .filter(Boolean);
  const uniqueExternalIds = [...new Set(selectedExternalIds)];

  if (!gameweekId) {
    redirect("/admin?tab=fixtures&error=Missing gameweek");
  }

  if (uniqueExternalIds.length === 0) {
    redirect(
      `/admin?tab=fixtures&gameweek=${gameweekId}&error=${encodeURIComponent(
        "Select at least one cached fixture",
      )}`,
    );
  }

  if (uniqueExternalIds.length !== selectedExternalIds.length) {
    redirect(
      `/admin?tab=fixtures&gameweek=${gameweekId}&error=${encodeURIComponent(
        "Each external fixture can only be selected once",
      )}`,
    );
  }

  const { data: gameweek } = await supabase
    .from("gameweeks")
    .select("id, season_id")
    .eq("id", gameweekId)
    .single();

  const typedGameweek = gameweek as AdminGameweekSeasonRow | null;

  if (!typedGameweek) {
    redirect("/admin?tab=fixtures&error=Gameweek not found");
  }

  const { data: activeSeason } = await getActiveSeason(
    supabase,
    "id, base_provider, base_competition_code, base_competition_name",
  );
  const activeSeasonConfig = activeSeason as ActiveSeasonExternalConfig | null;

  if (!activeSeasonConfig || typedGameweek.season_id !== activeSeasonConfig.id) {
    redirect(
      `/admin?tab=fixtures&gameweek=${gameweekId}&error=${encodeURIComponent(
        "This gameweek is not part of the active season",
      )}`,
    );
  }

  if (
    activeSeasonConfig.base_provider !== "football_data" ||
    !activeSeasonConfig.base_competition_code ||
    !selectedCompetitionCode
  ) {
    redirect(
      `/admin?tab=fixtures&gameweek=${gameweekId}&error=${encodeURIComponent(
        "External fixtures are not configured for the active season",
      )}`,
    );
  }

  const allowOtherCompetitions = canBrowseOtherCompetitions(
    activeSeasonConfig.base_competition_code,
  );
  const isBaseCompetition =
    selectedCompetitionCode === activeSeasonConfig.base_competition_code;

  if (!allowOtherCompetitions && !isBaseCompetition) {
    redirect(
      `/admin?tab=fixtures&gameweek=${gameweekId}&error=${encodeURIComponent(
        "This tournament season only allows cached fixtures from the base competition",
      )}`,
    );
  }

  const { data: externalFixtures, error: externalFixturesError } = await supabase
    .from("external_fixtures")
    .select(
      "provider, external_fixture_id, external_competition_code, external_round, external_matchday, external_stage, external_group, home_team, away_team, kickoff_at, status, raw_payload, last_synced_at",
    )
    .eq("provider", "football_data")
    .eq("external_competition_code", selectedCompetitionCode)
    .in("external_fixture_id", uniqueExternalIds);

  if (externalFixturesError) {
    redirect(
      `/admin?tab=fixtures&gameweek=${gameweekId}&error=${encodeURIComponent(
        externalFixturesError.message,
      )}`,
    );
  }

  const externalFixtureList =
    (externalFixtures as ExternalFixtureRow[] | null) ?? [];

  if (externalFixtureList.length !== uniqueExternalIds.length) {
    redirect(
      `/admin?tab=fixtures&gameweek=${gameweekId}&error=${encodeURIComponent(
        "One or more selected cached fixtures could not be found",
      )}`,
    );
  }

  const invalidFixture = externalFixtureList.find(
    (fixture) => !mapExternalStatusToFixtureStatus(fixture.status),
  );

  if (invalidFixture) {
    redirect(
      `/admin?tab=fixtures&gameweek=${gameweekId}&error=${encodeURIComponent(
        `${invalidFixture.home_team} vs ${invalidFixture.away_team} is not selectable`,
      )}`,
    );
  }

  const timingWindow = await getAdminGameweekTimingWindow({
    supabase,
    gameweekId,
    baseCompetitionCode: activeSeasonConfig.base_competition_code,
  });
  const selectedOutsideTimingWindow = externalFixtureList.some((fixture) =>
    isKickoffOutsideTimingWindow({
      kickoffAt: fixture.kickoff_at,
      timingWindow,
    }),
  );

  if (
    selectedOutsideTimingWindow &&
    formData.get("confirm_timing_override") !== "1"
  ) {
    redirect(
      `/admin?tab=fixtures&gameweek=${gameweekId}&competition=${selectedCompetitionCode}&error=${encodeURIComponent(
        "One or more selected fixtures is outside the usual gameweek window. Tick \"Add it anyway\" to confirm.",
      )}`,
    );
  }

  if (allowOtherCompetitions && !isBaseCompetition) {
    const { data: baseFixturesForCutoff } = await supabase
      .from("external_fixtures")
      .select("external_matchday, external_stage, kickoff_at")
      .eq("provider", "football_data")
      .eq("external_competition_code", activeSeasonConfig.base_competition_code)
      .in("status", ["TIMED", "SCHEDULED"])
      .gt("kickoff_at", new Date().toISOString())
      .order("kickoff_at", { ascending: true });
    const specialFixtureCutoff = getSpecialFixtureCutoff({
      baseGroups: buildFixtureGroupTimings(
        (baseFixturesForCutoff as ExternalGroupTimingRow[] | null) ?? [],
      ),
      currentGroupKey: null,
    });
    const ineligibleSpecialFixture = externalFixtureList.find(
      (fixture) =>
        !isKickoffBeforeSpecialFixtureCutoff({
          kickoffAt: fixture.kickoff_at,
          cutoff: specialFixtureCutoff,
        }),
    );

    if (ineligibleSpecialFixture) {
      redirect(
        `/admin?tab=fixtures&gameweek=${gameweekId}&competition=${selectedCompetitionCode}&error=${encodeURIComponent(
          "One or more selected fixtures is too close to the next base-league gameweek",
        )}`,
      );
    }
  }

  const { data: seasonGameweeks } = await supabase
    .from("gameweeks")
    .select("id")
    .eq("season_id", typedGameweek.season_id);

  const seasonGameweekIds =
    (seasonGameweeks as { id: string }[] | null)?.map((row) => row.id) ?? [];

  const { data: duplicateFixtures } =
    seasonGameweekIds.length > 0
      ? await supabase
          .from("fixtures")
          .select("external_fixture_id, gameweek_id")
          .in("gameweek_id", seasonGameweekIds)
          .eq("external_provider", "football_data")
          .in("external_fixture_id", uniqueExternalIds)
      : { data: [] };

  const existingExternalFixtures =
    (duplicateFixtures as
      | { external_fixture_id: string | null; gameweek_id: string }[]
      | null) ?? [];
  const duplicateInAnotherGameweek = existingExternalFixtures.find(
    (fixture) => fixture.gameweek_id !== gameweekId,
  );
  const duplicateInCurrentGameweek = new Set(
    existingExternalFixtures
      .filter((fixture) => fixture.gameweek_id === gameweekId)
      .map((fixture) => fixture.external_fixture_id)
      .filter((value): value is string => Boolean(value)),
  );

  if (duplicateInAnotherGameweek?.external_fixture_id) {
    redirect(
      `/admin?tab=fixtures&gameweek=${gameweekId}&error=${encodeURIComponent(
        "One of those fixtures has already been selected for another gameweek",
      )}`,
    );
  }

  const externalFixtureById = new Map(
    externalFixtureList.map((fixture) => [fixture.external_fixture_id, fixture]),
  );
  const { data: selectedCompetition } = await supabase
    .from("external_competitions")
    .select("name")
    .eq("provider", "football_data")
    .eq("external_competition_code", selectedCompetitionCode)
    .maybeSingle();
  const competitionName =
    selectedCompetitionCode === activeSeasonConfig.base_competition_code
      ? activeSeasonConfig.base_competition_name
      : ((selectedCompetition as { name: string } | null)?.name ??
        selectedCompetitionCode);
  const rows = uniqueExternalIds
    .filter((externalFixtureId) => !duplicateInCurrentGameweek.has(externalFixtureId))
    .map((externalFixtureId) =>
      buildLocalFixtureFromExternal({
        fixture: externalFixtureById.get(externalFixtureId)!,
        gameweekId,
        competitionName,
      }),
    );

  if (rows.length === 0) {
    redirect(
      `/admin?tab=fixtures&gameweek=${gameweekId}&error=${encodeURIComponent(
        "Selected cached fixtures are already in this gameweek",
      )}`,
    );
  }

  const { error: insertError } = await supabase.from("fixtures").insert(rows);

  if (insertError) {
    redirect(
      `/admin?tab=fixtures&gameweek=${gameweekId}&error=${encodeURIComponent(
        insertError.message,
      )}`,
    );
  }

  await upsertFixturesPickedActivityIfNoPredictions({
    supabase,
    gameweekId,
    actioningUserId: user.id,
  });

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/predictions");

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
  const { supabase, user } = await requireAdmin();

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

  if (existingFixture?.gameweek_id) {
    await upsertFixturesPickedActivityIfNoPredictions({
      supabase,
      gameweekId: existingFixture.gameweek_id,
      actioningUserId: user.id,
    });
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");

  const gameweekQuery = existingFixture?.gameweek_id
    ? `&gameweek=${existingFixture.gameweek_id}`
    : "";

  redirect(`/admin?tab=fixtures${gameweekQuery}&saved=1`);
}

export async function deleteFixture(formData: FormData) {
  const { supabase, user } = await requireAdmin();

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

  if (existingFixture?.gameweek_id) {
    await upsertFixturesPickedActivityIfNoPredictions({
      supabase,
      gameweekId: existingFixture.gameweek_id,
      actioningUserId: user.id,
    });
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

export async function rolloverActiveSeason(formData: FormData) {
  const { supabase, user } = await requireAdmin();

  const sourceSeasonId = String(formData.get("source_season_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const providerSeason =
    String(formData.get("provider_season") ?? "").trim() || null;
  const gameweekCount = Number(formData.get("gameweek_count") ?? 0);
  const showOldInArchive =
    String(formData.get("show_old_in_archive") ?? "") === "on";

  if (!sourceSeasonId) {
    redirect(
      getSeasonRedirectUrl({
        error: "No active season selected for rollover",
      }),
    );
  }

  if (!name) {
    redirect(
      getSeasonRedirectUrl({
        error: "Next season name is required",
      }),
    );
  }

  if (
    !Number.isInteger(gameweekCount) ||
    gameweekCount < 1 ||
    gameweekCount > 60
  ) {
    redirect(
      getSeasonRedirectUrl({
        error: "Gameweek count must be between 1 and 60",
      }),
    );
  }

  const { data: sourceSeason, error: sourceSeasonError } = await supabase
    .from("seasons")
    .select(
      "id, name, status, season_type, base_provider, base_competition_code, base_competition_name, base_competition_external_id, fixture_import_enabled, result_sync_enabled",
    )
    .eq("id", sourceSeasonId)
    .eq("status", "active")
    .single();

  if (sourceSeasonError || !sourceSeason) {
    redirect(
      getSeasonRedirectUrl({
        error:
          sourceSeasonError?.message ??
          "Rollover can only start from the current active season",
      }),
    );
  }

  const approvedPlayers = await getApprovedPlayerIds({ supabase });

  if (approvedPlayers.length === 0) {
    redirect(
      getSeasonRedirectUrl({
        error: "No approved users found to assign as fixture pickers",
      }),
    );
  }

  const { data: nextSeason, error: nextSeasonError } = await supabase
    .from("seasons")
    .insert({
      name,
      description: description || null,
      season_type: sourceSeason.season_type ?? "standard",
      status: "draft",
      base_provider: sourceSeason.base_provider,
      base_competition_code: sourceSeason.base_competition_code,
      base_competition_name: sourceSeason.base_competition_name,
      base_competition_external_id: sourceSeason.base_competition_external_id,
      provider_season: providerSeason,
      fixture_import_enabled: Boolean(sourceSeason.fixture_import_enabled),
      result_sync_enabled: Boolean(sourceSeason.result_sync_enabled),
      created_by: user.id,
    })
    .select("id")
    .single();

  if (nextSeasonError || !nextSeason) {
    redirect(
      getSeasonRedirectUrl({
        error: nextSeasonError?.message ?? "Could not create next season",
      }),
    );
  }

  try {
    await createGameweeksForSeason({
      supabase,
      seasonId: nextSeason.id,
      targetCount: gameweekCount,
    });

    await autoAssignPickersForSeason({
      supabase,
      seasonId: nextSeason.id,
    });
  } catch (rolloverSetupError) {
    redirect(
      getSeasonRedirectUrl({
        error:
          rolloverSetupError instanceof Error
            ? `Next season was created as draft, but setup failed: ${rolloverSetupError.message}`
            : "Next season was created as draft, but setup failed",
      }),
    );
  }

  const archivedAt = new Date().toISOString();
  const { error: archiveActiveError } = await supabase
    .from("seasons")
    .update({
      status: "archived",
      archived_at: archivedAt,
      archived_by: user.id,
      show_in_archive: showOldInArchive,
    })
    .eq("status", "active");

  if (archiveActiveError) {
    redirect(
      getSeasonRedirectUrl({
        error: `Next season was created as draft, but current season could not be archived: ${archiveActiveError.message}`,
      }),
    );
  }

  const { error: activateNextError } = await supabase
    .from("seasons")
    .update({
      status: "active",
      archived_at: null,
      archived_by: null,
    })
    .eq("id", nextSeason.id);

  if (activateNextError) {
    await supabase
      .from("seasons")
      .update({
        status: "active",
        archived_at: null,
        archived_by: null,
      })
      .eq("id", sourceSeasonId);

    redirect(
      getSeasonRedirectUrl({
        error: `Current season was restored if possible, but next season could not be activated: ${activateNextError.message}`,
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

export async function updateActiveSeasonProviderSettings(formData: FormData) {
  const { supabase } = await requireAdmin();

  const seasonId = String(formData.get("season_id") ?? "");
  const baseProviderRaw = String(formData.get("base_provider") ?? "none");
  const baseCompetitionCode = String(
    formData.get("base_competition_code") ?? "",
  );
  const providerSeason =
    String(formData.get("provider_season") ?? "").trim() || null;
  const fixtureImportEnabled =
    String(formData.get("fixture_import_enabled") ?? "") === "on";
  const resultSyncEnabled =
    String(formData.get("result_sync_enabled") ?? "") === "on";

  if (!seasonId) {
    redirect(
      getSeasonRedirectUrl({
        error: "No active season selected",
      }),
    );
  }

  const { data: activeSeason, error: activeSeasonError } = await supabase
    .from("seasons")
    .select("id, status")
    .eq("id", seasonId)
    .eq("status", "active")
    .single();

  if (activeSeasonError || !activeSeason) {
    redirect(
      getSeasonRedirectUrl({
        error:
          activeSeasonError?.message ??
          "Provider settings can only be changed for the active season",
      }),
    );
  }

  if (baseProviderRaw === "none") {
    const { error } = await supabase
      .from("seasons")
      .update({
        base_provider: null,
        base_competition_code: null,
        base_competition_name: null,
        base_competition_external_id: null,
        provider_season: providerSeason,
        fixture_import_enabled: false,
        result_sync_enabled: false,
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
    revalidatePath("/pick-fixtures");

    redirect(
      getSeasonRedirectUrl({
        saved: "1",
      }),
    );
  }

  if (baseProviderRaw !== "football_data") {
    redirect(
      getSeasonRedirectUrl({
        error: "Unsupported provider",
      }),
    );
  }

  const competition = getFootballDataCompetitionOption(baseCompetitionCode);

  if (!competition) {
    redirect(
      getSeasonRedirectUrl({
        error: "Unsupported football-data competition",
      }),
    );
  }

  const { error } = await supabase
    .from("seasons")
    .update({
      base_provider: "football_data",
      base_competition_code: competition.external_competition_code,
      base_competition_name: competition.name,
      base_competition_external_id: competition.external_competition_id,
      provider_season: providerSeason,
      fixture_import_enabled: fixtureImportEnabled,
      result_sync_enabled: resultSyncEnabled,
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
  revalidatePath("/pick-fixtures");
  revalidatePath("/dashboard");

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
  const seasonsToRecalculate = new Set<string>();

  if (gameweekIds.length === 0) {
    redirect(
      getSeasonRedirectUrl({
        error: "No gameweeks found to update",
      }),
    );
  }

  for (const gameweekId of gameweekIds) {
    const { data: currentGameweek, error: currentGameweekError } = await supabase
      .from("gameweeks")
      .select(
        `
        id,
        season_id,
        is_double_gameweek,
        fixtures (
          id,
          status
        )
      `,
      )
      .eq("id", gameweekId)
      .single();

    if (currentGameweekError || !currentGameweek) {
      redirect(
        getSeasonRedirectUrl({
          error: currentGameweekError?.message ?? "Gameweek not found",
        }),
      );
    }

    const fixturePickerIdRaw = String(
      formData.get(`fixture_picker_id_${gameweekId}`) ?? "",
    );

    const fixturePickerId =
      fixturePickerIdRaw && fixturePickerIdRaw !== "unassigned"
        ? fixturePickerIdRaw
        : null;
    const isDoubleGameweek =
      String(formData.get(`is_double_gameweek_${gameweekId}`) ?? "") === "on";
    const currentFixtureRows =
      (currentGameweek.fixtures as { id: string; status: string }[] | null) ?? [];
    const completedFixtureIds = currentFixtureRows
      .filter((fixture) => fixture.status === "completed")
      .map((fixture) => fixture.id);
    const doubleGameweekChanged =
      Boolean(currentGameweek.is_double_gameweek) !== isDoubleGameweek;

    const { error } = await supabase
      .from("gameweeks")
      .update({
        fixture_picker_id: fixturePickerId,
        is_double_gameweek: isDoubleGameweek,
      })
      .eq("id", gameweekId);

    if (error) {
      redirect(
        getSeasonRedirectUrl({
          error: error.message,
        }),
      );
    }

    if (isDoubleGameweek && currentFixtureRows.length > 0) {
      const { error: jokerDeleteError } = await supabase
        .from("joker_usage")
        .delete()
        .in(
          "fixture_id",
          currentFixtureRows.map((fixture) => fixture.id),
        );

      if (jokerDeleteError) {
        redirect(
          getSeasonRedirectUrl({
            error: jokerDeleteError.message,
          }),
        );
      }
    }

    if (doubleGameweekChanged && completedFixtureIds.length > 0) {
      for (const fixtureId of completedFixtureIds) {
        await scoreFixture(fixtureId, supabase);
      }

      seasonsToRecalculate.add(currentGameweek.season_id);
    }
  }

  for (const seasonId of seasonsToRecalculate) {
    await recalculateLeaderboard(seasonId, supabase);
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/pick-fixtures");
  revalidatePath("/predictions");
  revalidatePath("/leaderboard");

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

async function getGameweekFixtureIds({
  supabase,
  gameweekId,
}: {
  supabase: SupabaseLikeClient;
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
  supabase: SupabaseLikeClient;
  gameweekId: string;
}) {
  const { data: gameweek } = await supabase
    .from("gameweeks")
    .select("id, season_id, gameweek_number, name, is_double_gameweek")
    .eq("id", gameweekId)
    .single();

  const typedGameweek = gameweek as ActivityGameweekRow | null;

  if (!typedGameweek) {
    return false;
  }

  const fixtures = await getGameweekFixtureIds({
    supabase,
    gameweekId,
  });

  if (!isGameweekComplete(fixtures)) {
    return false;
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

  // `leaderboard_entries.previous_rank` can change during repeated scoring
  // within one gameweek, so it is not a reliable completed-gameweek snapshot.
  // Suppress movement activity until a dedicated snapshot table exists.
  const biggestRisers: { name: string; movement: number }[] = [];
  const biggestFallers: { name: string; movement: number }[] = [];

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

  await upsertActivityNotification({
    eventKey: `gameweek_complete:${gameweekId}`,
    type: "results_available",
    title: `${gameweekName} complete`,
    body: `${gameweekName} is complete. ${winnerText}`,
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

  await generateLeagueFactNotifications({
    supabase,
    seasonId: typedGameweek.season_id,
    gameweekId,
    gameweekNumber: typedGameweek.gameweek_number,
    gameweekName,
    isDoubleGameweek: Boolean(typedGameweek.is_double_gameweek),
    fixtures,
    weeklyLeaderboard,
    biggestRisers,
    biggestFallers,
  });

  return true;
}

async function upsertNextPickerActivity({
  supabase,
  completedGameweekId,
}: {
  supabase: SupabaseLikeClient;
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

  const { data: nextFixtures } = await supabase
    .from("fixtures")
    .select("id, status, external_provider, external_fixture_id")
    .eq("gameweek_id", typedNextGameweek.id);
  const nextFixtureList =
    (nextFixtures as
      | {
          id: string;
          status: string;
          external_provider: string | null;
          external_fixture_id: string | null;
        }[]
      | null) ?? [];
  const nextSelectionStatus = getFixtureSelectionStatus(nextFixtureList);
  const nextGameweekTerminal =
    nextFixtureList.length > 0 &&
    nextFixtureList.every((fixture) =>
      ["completed", "postponed", "void"].includes(fixture.status),
    );

  if (nextGameweekTerminal || nextSelectionStatus.isComplete) {
    return;
  }

  const nextFixtureIds = nextFixtureList.map((fixture) => fixture.id);
  const { data: existingPrediction } =
    nextFixtureIds.length > 0
      ? await supabase
          .from("predictions")
          .select("fixture_id")
          .in("fixture_id", nextFixtureIds)
          .limit(1)
          .maybeSingle()
      : { data: null };

  if (existingPrediction) {
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

  try {
    const emailResult = await sendPickerUpNextEmail({
      supabase: createAdminClient(),
      gameweekId: typedNextGameweek.id,
    });

    if (emailResult.error) {
      console.warn(`Picker-up-next email skipped: ${emailResult.error}`);
    }
  } catch (error) {
    console.warn(
      `Picker-up-next email skipped: ${
        error instanceof Error ? error.message : "unknown email error"
      }`,
    );
  }
}

export async function upsertPostResultActivityForGameweeks({
  supabase,
  gameweekIds,
}: {
  supabase: SupabaseLikeClient;
  gameweekIds: Iterable<string>;
}) {
  for (const gameweekId of new Set(gameweekIds)) {
    const gameweekComplete = await upsertGameweekCompleteActivity({
      supabase,
      gameweekId,
    });

    if (!gameweekComplete) {
      continue;
    }

    await upsertNextPickerActivity({
      supabase,
      completedGameweekId: gameweekId,
    });
  }
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

  await upsertPostResultActivityForGameweeks({
    supabase,
    gameweekIds: updatedGameweekIds,
  });

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/predictions");
  revalidatePath("/leaderboard");

  redirect("/admin?tab=results&saved=1");
}
