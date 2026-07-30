export const dynamic = "force-dynamic";

import { createClient } from "@/utils/supabase/server";
import { getActiveSeason } from "@/utils/seasons";
import {
  calculateProvisionalPredictionScore,
  isLiveExternalStatus,
} from "@/utils/provisional-scoring";
import {
  buildTeamStandingLookup,
  getMeaningfulStandingRows,
  getStandingForTeam,
  type TeamStandingDisplayRow,
} from "@/utils/team-standings-display";
import { getProviderTeamIdentityFromRawPayload } from "@/utils/team-assets";
import type {
  ExternalFixtureScore,
  Fixture,
  LeaderboardSummary,
  Prediction,
} from "@/components/predictions/types";

type ActiveSeasonForLiveSummary = {
  id: string;
  provider_season: string | null;
};

function isTerminalFixture(fixture: Fixture) {
  return ["completed", "postponed", "void"].includes(fixture.status);
}

function isFixtureLocked(fixture: Fixture) {
  return fixture.status !== "scheduled" || new Date(fixture.kickoff_at) <= new Date();
}

function getPollRecommendation({
  fixtures,
  externalScoresByFixtureId,
  predictionsByFixture,
  currentUserId,
}: {
  fixtures: Fixture[];
  externalScoresByFixtureId: Map<string, ExternalFixtureScore>;
  predictionsByFixture: Map<string, Prediction[]>;
  currentUserId: string;
}) {
  if (fixtures.length === 0) {
    return { shouldPoll: false, intervalMs: 60000 };
  }

  const now = Date.now();
  let hasLiveFixture = false;
  let hasLockedNotFinal = false;
  let hasCloseKickoff = false;
  let hasCompletedUnscored = false;

  for (const fixture of fixtures) {
    const externalScore = fixture.external_fixture_id
      ? externalScoresByFixtureId.get(fixture.external_fixture_id)
      : null;

    if (isLiveExternalStatus(externalScore?.status)) {
      hasLiveFixture = true;
    }

    if (isFixtureLocked(fixture) && !isTerminalFixture(fixture)) {
      hasLockedNotFinal = true;
    }

    const kickoffDelta = new Date(fixture.kickoff_at).getTime() - now;
    if (
      fixture.status === "scheduled" &&
      kickoffDelta > 0 &&
      kickoffDelta <= 10 * 60 * 1000
    ) {
      hasCloseKickoff = true;
    }

    if (fixture.status === "completed") {
      const ownPrediction = (predictionsByFixture.get(fixture.id) ?? []).find(
        (prediction) => prediction.user_id === currentUserId,
      );

      if (ownPrediction && ownPrediction.points === null) {
        hasCompletedUnscored = true;
      }
    }
  }

  return {
    shouldPoll:
      hasLiveFixture ||
      hasLockedNotFinal ||
      hasCloseKickoff ||
      hasCompletedUnscored,
    intervalMs: hasLiveFixture ? 30000 : 60000,
  };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const url = new URL(request.url);
  const gameweekId = url.searchParams.get("gameweek_id");

  if (!gameweekId) {
    return Response.json({ error: "gameweek_id is required" }, { status: 400 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", user.id)
    .single();

  if (profile?.status !== "approved") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: activeSeason } = await getActiveSeason(
    supabase,
    "id, provider_season",
  );

  if (!activeSeason) {
    return Response.json({ error: "No active season" }, { status: 404 });
  }
  const activeSeasonConfig = activeSeason as ActiveSeasonForLiveSummary;

  const { data: gameweek, error: gameweekError } = await supabase
    .from("gameweeks")
    .select("id, season_id, is_double_gameweek")
    .eq("id", gameweekId)
    .eq("season_id", activeSeason.id)
    .single();

  if (gameweekError || !gameweek) {
    return Response.json(
      { error: gameweekError?.message ?? "Gameweek not found" },
      { status: 404 },
    );
  }

  const isDoubleGameweek = Boolean(gameweek.is_double_gameweek);

  const { data: fixtures } = await supabase
    .from("fixtures")
    .select(
      "id, gameweek_id, home_team, away_team, kickoff_at, competition, status, home_score, away_score, external_provider, external_fixture_id, external_competition_code, external_round, external_matchday, external_status, external_last_synced_at, external_raw_payload",
    )
    .eq("gameweek_id", gameweekId)
    .order("kickoff_at", { ascending: true });

  const fixtureList = (fixtures as Fixture[] | null) ?? [];
  const fixtureIds = fixtureList.map((fixture) => fixture.id);
  const externalFixtureIds = fixtureList
    .map((fixture) => fixture.external_fixture_id)
    .filter((value): value is string => Boolean(value));

  const { data: externalScoreRows } =
    externalFixtureIds.length > 0
      ? await supabase
          .from("external_fixtures")
          .select(
            "external_fixture_id, status, home_score, away_score, last_synced_at, raw_payload",
          )
          .eq("provider", "football_data")
          .in("external_fixture_id", externalFixtureIds)
      : { data: [] };

  const externalScoresByFixtureId = new Map(
    (
      (externalScoreRows as
        | (ExternalFixtureScore & { external_fixture_id: string })[]
        | null) ?? []
    ).map((row) => [
      row.external_fixture_id,
      {
        status: row.status,
        home_score: row.home_score,
        away_score: row.away_score,
        last_synced_at: row.last_synced_at,
      },
    ]),
  );
  const externalFixturePayloadById = new Map(
    (
      (externalScoreRows as
        | { external_fixture_id: string; raw_payload?: unknown }[]
        | null) ?? []
    ).map((row) => [row.external_fixture_id, row.raw_payload]),
  );
  const fixtureCompetitionCodes = [
    ...new Set(
      fixtureList
        .map((fixture) => fixture.external_competition_code)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  let standingRows: unknown[] | null = [];

  if (fixtureCompetitionCodes.length > 0) {
    let standingQuery = supabase
      .from("external_team_standings")
      .select(
        "external_competition_code, provider_season, team_name, team_short_name, team_tla, crest_url, position, played, won, drawn, lost, points",
      )
      .eq("provider", "football_data")
      .in("external_competition_code", fixtureCompetitionCodes);

    if (activeSeasonConfig.provider_season) {
      standingQuery = standingQuery.eq(
        "provider_season",
        activeSeasonConfig.provider_season,
      );
    }

    const { data } = await standingQuery;
    standingRows = data;
  }

  const { meaningfulRows: meaningfulStandingRows } = getMeaningfulStandingRows(
    (standingRows as TeamStandingDisplayRow[] | null) ?? [],
  );
  const standingsByCompetitionAndTeam =
    buildTeamStandingLookup(meaningfulStandingRows);
  const fixtureListWithIdentity = fixtureList.map((fixture) => {
    const rawPayload =
      fixture.external_raw_payload ??
      (fixture.external_fixture_id
        ? externalFixturePayloadById.get(fixture.external_fixture_id)
        : null);
    const homeIdentity = getProviderTeamIdentityFromRawPayload(
      rawPayload,
      "home",
    );
    const awayIdentity = getProviderTeamIdentityFromRawPayload(
      rawPayload,
      "away",
    );
    const homeStanding = getStandingForTeam({
      lookup: standingsByCompetitionAndTeam,
      competitionCode: fixture.external_competition_code,
      teamName:
        homeIdentity.displayName ??
        homeIdentity.shortName ??
        fixture.home_team,
    });
    const awayStanding = getStandingForTeam({
      lookup: standingsByCompetitionAndTeam,
      competitionCode: fixture.external_competition_code,
      teamName:
        awayIdentity.displayName ??
        awayIdentity.shortName ??
        fixture.away_team,
    });

    return {
      ...fixture,
      home_team_code: homeIdentity.teamCode,
      away_team_code: awayIdentity.teamCode,
      home_crest_url: homeIdentity.crestUrl ?? homeStanding?.crestUrl ?? null,
      away_crest_url: awayIdentity.crestUrl ?? awayStanding?.crestUrl ?? null,
      home_position_label: homeStanding?.positionLabel ?? null,
      away_position_label: awayStanding?.positionLabel ?? null,
    };
  });

  const { data: predictions } =
    fixtureIds.length > 0
      ? await supabase
          .from("predictions")
          .select(
            `
            fixture_id,
            user_id,
            home_score,
            away_score,
            points,
            is_exact_score,
            is_correct_result,
            profiles (
              display_name
            )
          `,
          )
          .in("fixture_id", fixtureIds)
      : { data: [] };

  const predictionsByFixture = new Map<string, Prediction[]>();
  const allPredictions = (predictions as Prediction[] | null) ?? [];

  for (const prediction of allPredictions) {
    const fixture = fixtureList.find(
      (item) => item.id === prediction.fixture_id,
    );

    if (!fixture) {
      continue;
    }

    const canShowOtherPredictions = isFixtureLocked(fixture);

    if (!canShowOtherPredictions && prediction.user_id !== user.id) {
      continue;
    }

    const existing = predictionsByFixture.get(prediction.fixture_id) ?? [];
    existing.push(prediction);
    predictionsByFixture.set(prediction.fixture_id, existing);
  }

  const { data: jokerUsage } =
    fixtureIds.length > 0
      ? await supabase
          .from("joker_usage")
          .select("fixture_id, user_id")
          .in("fixture_id", fixtureIds)
          .is("refunded_at", null)
      : { data: [] };

  const ownJokerFixtureIds = new Set(
    (
      (jokerUsage as { fixture_id: string; user_id: string }[] | null) ?? []
    )
      .filter((joker) => joker.user_id === user.id)
      .map((joker) => joker.fixture_id),
  );

  const { data: leaderboardEntry } = await supabase
    .from("leaderboard_entries")
    .select("rank, total_points, weekly_points")
    .eq("season_id", activeSeason.id)
    .eq("user_id", user.id)
    .maybeSingle();

  let liveWeeklyPoints = 0;
  let hasLiveWeeklyPoints = false;
  let liveFixtureCount = 0;

  for (const fixture of fixtureList) {
    const ownPrediction = (predictionsByFixture.get(fixture.id) ?? []).find(
      (prediction) => prediction.user_id === user.id,
    );

    if (!ownPrediction) {
      continue;
    }

    if (fixture.status === "completed" && ownPrediction.points !== null) {
      liveWeeklyPoints += ownPrediction.points;
      continue;
    }

    const externalScore = fixture.external_fixture_id
      ? externalScoresByFixtureId.get(fixture.external_fixture_id)
      : null;

    if (
      !externalScore ||
      !isLiveExternalStatus(externalScore.status) ||
      externalScore.home_score === null ||
      externalScore.away_score === null
    ) {
      continue;
    }

    const usedJoker =
      !isDoubleGameweek && ownJokerFixtureIds.has(fixture.id);
    liveWeeklyPoints += calculateProvisionalPredictionScore({
      predictionHome: ownPrediction.home_score,
      predictionAway: ownPrediction.away_score,
      actualHome: externalScore.home_score,
      actualAway: externalScore.away_score,
      usedJoker,
      isDoubleGameweek,
    }).points;
    hasLiveWeeklyPoints = true;
    liveFixtureCount += 1;
  }

  const poll = getPollRecommendation({
    fixtures: fixtureList,
    externalScoresByFixtureId,
    predictionsByFixture,
    currentUserId: user.id,
  });

  const externalScores = Object.fromEntries(externalScoresByFixtureId);
  const predictionRecord = Object.fromEntries(predictionsByFixture);

  return Response.json(
    {
      gameweek_id: gameweekId,
      should_poll: poll.shouldPoll,
      next_interval_ms: poll.intervalMs,
      last_updated_at: new Date().toISOString(),
      fixtures: fixtureListWithIdentity,
      external_scores: externalScores,
      predictions_by_fixture: predictionRecord,
      leaderboard_entry: (leaderboardEntry as LeaderboardSummary) ?? null,
      live_weekly_points: hasLiveWeeklyPoints ? liveWeeklyPoints : null,
      live_fixture_count: liveFixtureCount,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
