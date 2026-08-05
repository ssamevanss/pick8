export const dynamic = "force-dynamic";

import GameweekSelector from "@/components/gameweeks/GameweekSelector";
import PredictionsLivePanel from "@/components/predictions/PredictionsLivePanel";
import type {
  Fixture,
  ExternalFixtureScore,
  FixtureTeamForm,
  Gameweek,
  JokerUsage,
  LeaderboardSummary,
  Prediction,
  ReactionSummary,
  TeamFormResult,
} from "@/components/predictions/types";
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
import { getSeasonCompetitionMode } from "@/utils/football-competitions";
import { savePredictions } from "./actions";
import { getAppLeagueContext } from "@/utils/legacy-app-context";
import { logServerTiming, startServerTiming } from "@/utils/server-timing";

type CompletedFixtureForForm = {
  id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  home_score: number;
  away_score: number;
};

type ExternalCompletedFixtureForForm = CompletedFixtureForForm & {
  external_competition_code: string;
  provider_season?: string | null;
};

type ActiveSeasonForPredictions = {
  id: string;
  provider_season: string | null;
};

type GameweekWithFixtures = Gameweek & {
  fixtures: { id: string }[];
};

function getTeamFormResult({
  teamName,
  fixture,
}: {
  teamName: string;
  fixture: CompletedFixtureForForm;
}): TeamFormResult {
  const isHome = fixture.home_team === teamName;
  const goalsFor = isHome ? fixture.home_score : fixture.away_score;
  const goalsAgainst = isHome ? fixture.away_score : fixture.home_score;
  const opponent = isHome ? fixture.away_team : fixture.home_team;
  const result =
    goalsFor > goalsAgainst ? "W" : goalsFor === goalsAgainst ? "D" : "L";

  return {
    fixtureId: fixture.id,
    opponent,
    kickoffAt: fixture.kickoff_at,
    goalsFor,
    goalsAgainst,
    result,
    venue: isHome ? "H" : "A",
  };
}

function getRecentTeamForm({
  teamName,
  fixtureKickoffAt,
  completedFixtures,
  competitionCode,
}: {
  teamName: string;
  fixtureKickoffAt: string;
  completedFixtures: (CompletedFixtureForForm | ExternalCompletedFixtureForForm)[];
  competitionCode?: string | null;
}) {
  return completedFixtures
    .filter(
      (fixture) =>
        fixture.kickoff_at < fixtureKickoffAt &&
        (!competitionCode ||
          !("external_competition_code" in fixture) ||
          fixture.external_competition_code === competitionCode) &&
        (fixture.home_team === teamName || fixture.away_team === teamName),
    )
    .sort(
      (a, b) =>
        new Date(b.kickoff_at).getTime() - new Date(a.kickoff_at).getTime(),
    )
    .slice(0, 6)
    .map((fixture) => getTeamFormResult({ teamName, fixture }));
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{
    saved?: string;
    error?: string;
    gameweek?: string;
  }>;
}) {
  const params = searchParams ? await searchParams : {};
  const pageStartedAt = startServerTiming();
  const { supabase, user, selectedLeague, activeSeason } =
    await getAppLeagueContext();
  const activeSeasonConfig = activeSeason as ActiveSeasonForPredictions | null;

  const { data: gameweeks } = activeSeason
    ? await supabase
        .from("gameweeks")
        .select(
          "id, gameweek_number, name, is_double_gameweek, fixtures(id)",
        )
        .eq("season_id", activeSeason.id)
        .order("gameweek_number", { ascending: true })
    : { data: null };

  const gameweekList = (gameweeks as GameweekWithFixtures[] | null) ?? [];

  const latestGameweekWithFixtures =
    [...gameweekList]
      .reverse()
      .find((gameweek) => gameweek.fixtures.length > 0) ?? null;

  const selectedGameweek =
    gameweekList.find((gameweek) => gameweek.id === params.gameweek) ??
    latestGameweekWithFixtures ??
    gameweekList[gameweekList.length - 1] ??
    null;
  const isDoubleGameweek = Boolean(selectedGameweek?.is_double_gameweek);

  const { data: fixtures, error: fixturesError } = selectedGameweek
    ? await supabase
        .from("fixtures")
        .select(
          "id, gameweek_id, home_team, away_team, kickoff_at, competition, status, home_score, away_score, external_provider, external_fixture_id, external_competition_code, external_round, external_matchday, external_status, external_last_synced_at, external_raw_payload",
        )
        .eq("gameweek_id", selectedGameweek.id)
        .order("kickoff_at", { ascending: true })
    : { data: null, error: null };

  const fixtureIds = ((fixtures as Fixture[] | null) ?? []).map(
    (fixture) => fixture.id,
  );
  const fixtureList = (fixtures as Fixture[] | null) ?? [];
  const externalFixtureIds = fixtureList
    .map((fixture) => fixture.external_fixture_id)
    .filter((value): value is string => Boolean(value));

  const [
    { data: externalScoreRows },
    { data: predictions, error: predictionsError },
    { data: predictionReactions },
    { data: jokerUsage, error: jokerUsageError },
    { data: seasonJokerUsage },
    { data: leaderboardEntry },
  ] = await Promise.all([
    externalFixtureIds.length > 0
      ? supabase
          .from("external_fixtures")
          .select(
            "external_fixture_id, status, home_score, away_score, last_synced_at, raw_payload, provider_season",
          )
          .eq("provider", "football_data")
          .in("external_fixture_id", externalFixtureIds)
      : Promise.resolve({ data: [] }),
    fixtureIds.length > 0
      ? supabase
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
      : Promise.resolve({ data: null, error: null }),
    fixtureIds.length > 0
      ? supabase
          .from("prediction_reactions")
          .select("fixture_id, prediction_user_id, user_id, emoji")
          .in("fixture_id", fixtureIds)
      : Promise.resolve({ data: [] }),
    fixtureIds.length > 0
      ? supabase
          .from("joker_usage")
          .select("fixture_id, user_id")
          .in("fixture_id", fixtureIds)
          .is("refunded_at", null)
      : Promise.resolve({ data: null, error: null }),
    activeSeason && user
      ? supabase
          .from("joker_usage")
          .select(
            `
            fixture_id,
            user_id,
            fixtures!inner (
              gameweeks!inner (
                season_id,
                is_double_gameweek
              )
            )
          `,
          )
          .eq("season_id", activeSeason.id)
          .eq("user_id", user.id)
          .is("refunded_at", null)
          .eq("fixtures.gameweeks.season_id", activeSeason.id)
      : Promise.resolve({ data: [] }),
    activeSeason && user
      ? supabase
          .from("leaderboard_entries")
          .select("rank, total_points, weekly_points")
          .eq("season_id", activeSeason.id)
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const externalScoreByFixtureId = new Map(
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
    (((externalScoreRows as
      | {
          external_fixture_id: string;
          raw_payload?: unknown;
          provider_season?: string | null;
        }[]
      | null) ?? [])).map((row) => [
      row.external_fixture_id,
      {
        rawPayload: row.raw_payload,
        providerSeason: row.provider_season ?? null,
      },
    ]),
  );


  const latestFixtureKickoff =
    fixtureList
      .map((fixture) => fixture.kickoff_at)
      .sort()
      .at(-1) ?? null;

  const fixtureCompetitionCodes = [
    ...new Set(
      fixtureList
        .map((fixture) => fixture.external_competition_code)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const [completedExternalFormFixtures, completedLocalFormFixtures, standingRows] =
    await Promise.all([
      (async () => {
        if (!latestFixtureKickoff || fixtureCompetitionCodes.length === 0) {
          return [];
        }

        let query = supabase
          .from("external_fixtures")
          .select(
            "external_fixture_id, external_competition_code, provider_season, home_team, away_team, kickoff_at, home_score, away_score",
          )
          .eq("provider", "football_data")
          .in("external_competition_code", fixtureCompetitionCodes)
          .eq("status", "FINISHED")
          .not("home_score", "is", null)
          .not("away_score", "is", null)
          .lt("kickoff_at", latestFixtureKickoff)
          .order("kickoff_at", { ascending: false })
          .limit(500);

        if (activeSeasonConfig?.provider_season) {
          query = query.eq(
            "provider_season",
            activeSeasonConfig.provider_season,
          );
        }

        return (await query).data ?? [];
      })(),
      activeSeason &&
      latestFixtureKickoff &&
      fixtureCompetitionCodes.length === 0
        ? supabase
            .from("fixtures")
            .select(
              `
              id,
              home_team,
              away_team,
              kickoff_at,
              home_score,
              away_score,
              gameweeks!inner (
                season_id
              )
            `,
            )
            .eq("gameweeks.season_id", activeSeason.id)
            .eq("status", "completed")
            .not("home_score", "is", null)
            .not("away_score", "is", null)
            .lt("kickoff_at", latestFixtureKickoff)
            .order("kickoff_at", { ascending: false })
            .then((result) => result.data ?? [])
        : Promise.resolve([]),
      (async () => {
        if (fixtureCompetitionCodes.length === 0) {
          return [];
        }

        let query = supabase
          .from("external_team_standings")
          .select(
            "external_competition_code, provider_season, team_name, team_short_name, team_tla, crest_url, position, played, won, drawn, lost, points, raw_payload",
          )
          .eq("provider", "football_data")
          .in("external_competition_code", fixtureCompetitionCodes);

        if (activeSeasonConfig?.provider_season) {
          query = query.eq(
            "provider_season",
            activeSeasonConfig.provider_season,
          );
        }

        return (await query).data ?? [];
      })(),
    ]);
  const completedFixtureRows =
    fixtureCompetitionCodes.length > 0
      ? ((completedExternalFormFixtures as
          | (ExternalCompletedFixtureForForm & { external_fixture_id: string })[]
          | null) ?? []).map((fixture) => ({
          id: fixture.external_fixture_id,
          external_competition_code: fixture.external_competition_code,
          home_team: fixture.home_team,
          away_team: fixture.away_team,
          kickoff_at: fixture.kickoff_at,
          home_score: fixture.home_score,
          away_score: fixture.away_score,
        }))
      : ((completedLocalFormFixtures as CompletedFixtureForForm[] | null) ?? []);
  const { meaningfulRows: meaningfulStandingRows, hiddenPreseasonGroups } =
    getMeaningfulStandingRows(
      (standingRows as TeamStandingDisplayRow[] | null) ?? [],
    );
  const standingsByCompetitionAndTeam =
    buildTeamStandingLookup(meaningfulStandingRows);
  const meaningfulStandingCompetitionCodes = new Set(
    meaningfulStandingRows.map((row) => row.external_competition_code),
  );

  const fixtureListWithPositions = fixtureList.map((fixture) => {
    const externalPayload =
      fixture.external_raw_payload ??
      (fixture.external_fixture_id
        ? externalFixturePayloadById.get(fixture.external_fixture_id)?.rawPayload
        : null);
    const homeIdentity = getProviderTeamIdentityFromRawPayload(
      externalPayload,
      "home",
    );
    const awayIdentity = getProviderTeamIdentityFromRawPayload(
      externalPayload,
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
      home_standing: homeStanding,
      away_standing: awayStanding,
    };
  });
  const formByFixture = new Map<string, FixtureTeamForm>();

  for (const fixture of fixtureListWithPositions) {
    formByFixture.set(fixture.id, {
      home: getRecentTeamForm({
        teamName: fixture.home_team,
        fixtureKickoffAt: fixture.kickoff_at,
        completedFixtures: completedFixtureRows,
        competitionCode: fixture.external_competition_code,
      }),
      away: getRecentTeamForm({
        teamName: fixture.away_team,
        fixtureKickoffAt: fixture.kickoff_at,
        completedFixtures: completedFixtureRows,
        competitionCode: fixture.external_competition_code,
      }),
      homeStanding: fixture.home_standing,
      awayStanding: fixture.away_standing,
      standingsUnavailableReason:
        fixture.external_competition_code &&
        (hiddenPreseasonGroups.has(
          `${fixture.external_competition_code}:${
            activeSeasonConfig?.provider_season ?? ""
          }`,
        ) ||
          (getSeasonCompetitionMode(fixture.external_competition_code) ===
            "league" &&
            !meaningfulStandingCompetitionCodes.has(
              fixture.external_competition_code,
            )))
          ? "Table available after matches are played"
          : null,
    });
  }

  const hasOpenPredictionFixtures = fixtureList.some(
    (fixture) =>
      fixture.status === "scheduled" && new Date(fixture.kickoff_at) > new Date(),
  );

  const predictionsByFixture = new Map<string, Prediction[]>();
  const predictionReactionsByKey = new Map<string, ReactionSummary[]>();

  for (const prediction of (predictions as Prediction[] | null) ?? []) {
    const fixture = fixtureList.find((item) => item.id === prediction.fixture_id);

    if (!fixture) {
      continue;
    }

    const canShowOtherPredictions =
      fixture.status !== "scheduled" ||
      new Date(fixture.kickoff_at) <= new Date();

    if (!canShowOtherPredictions && prediction.user_id !== user?.id) {
      continue;
    }

    const existing = predictionsByFixture.get(prediction.fixture_id) ?? [];
    existing.push(prediction);
    predictionsByFixture.set(prediction.fixture_id, existing);
  }

  const visiblePredictionKeys = new Set(
    [...predictionsByFixture.values()]
      .flat()
      .map((prediction) => `${prediction.fixture_id}:${prediction.user_id}`),
  );

  for (const reaction of
    (predictionReactions as
      | {
          fixture_id: string;
          prediction_user_id: string;
          user_id: string;
          emoji: string;
        }[]
      | null) ?? []) {
    const key = `${reaction.fixture_id}:${reaction.prediction_user_id}`;

    if (!visiblePredictionKeys.has(key)) {
      continue;
    }

    const existing = predictionReactionsByKey.get(key) ?? [];
    const summary = existing.find((item) => item.emoji === reaction.emoji);

    if (summary) {
      summary.count += 1;
      summary.reactedByCurrentUser =
        summary.reactedByCurrentUser || reaction.user_id === user?.id;
    } else {
      existing.push({
        emoji: reaction.emoji,
        count: 1,
        reactedByCurrentUser: reaction.user_id === user?.id,
      });
    }

    predictionReactionsByKey.set(key, existing);
  }

  const openFixtureIds = fixtureList
    .filter(
      (fixture) =>
        fixture.status === "scheduled" &&
        new Date(fixture.kickoff_at) > new Date(),
    )
    .map((fixture) => fixture.id);
  const userHasSavedOpenPredictions =
    openFixtureIds.length > 0 &&
    openFixtureIds.every((fixtureId) =>
      (predictionsByFixture.get(fixtureId) ?? []).some(
        (prediction) => prediction.user_id === user?.id,
      ),
    );

  const jokerRows = (jokerUsage as JokerUsage[] | null) ?? [];

  const ownJokerFixtureIds = new Set(
    jokerRows
      .filter((joker) => joker.user_id === user?.id)
      .map((joker) => joker.fixture_id),
  );

  const jokerPredictionKeys = new Set(
    jokerRows.map((joker) => `${joker.fixture_id}:${joker.user_id}`),
  );

  const jokersUsed = (
    (seasonJokerUsage as
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
      | null) ?? []
  ).filter((row) => {
    const fixture = Array.isArray(row.fixtures) ? row.fixtures[0] : row.fixtures;
    const gameweek = Array.isArray(fixture?.gameweeks)
      ? fixture.gameweeks[0]
      : fixture?.gameweeks;

    return !gameweek?.is_double_gameweek;
  }).length;
  const jokersLeft = Math.max(0, 3 - jokersUsed);
  let liveGameweekPoints = 0;
  let hasLiveGameweekPoints = false;
  let liveFixtureCount = 0;

  for (const fixture of fixtureList) {
    const ownPrediction = (predictionsByFixture.get(fixture.id) ?? []).find(
      (prediction) => prediction.user_id === user?.id,
    );

    if (!ownPrediction) {
      continue;
    }

    if (fixture.status === "completed" && ownPrediction.points !== null) {
      liveGameweekPoints += ownPrediction.points;
      continue;
    }

    const externalScore = fixture.external_fixture_id
      ? externalScoreByFixtureId.get(fixture.external_fixture_id)
      : null;

    if (
      !externalScore ||
      !isLiveExternalStatus(externalScore.status) ||
      externalScore.home_score === null ||
      externalScore.away_score === null
    ) {
      continue;
    }

    const usedJoker = !isDoubleGameweek && ownJokerFixtureIds.has(fixture.id);
    liveGameweekPoints += calculateProvisionalPredictionScore({
      predictionHome: ownPrediction.home_score,
      predictionAway: ownPrediction.away_score,
      actualHome: externalScore.home_score,
      actualAway: externalScore.away_score,
      usedJoker,
      isDoubleGameweek,
    }).points;
    hasLiveGameweekPoints = true;
    liveFixtureCount += 1;
  }

  logServerTiming("predictions.page", pageStartedAt, {
    userId: user?.id,
    leagueId: selectedLeague?.id,
  });

  return (
    <>
      <header className="brand-card mb-8 p-5 sm:p-6">
        <p className="brand-eyebrow">Match calls</p>
        <h1 className="brand-title mt-2">Predictions</h1>
        <p className="brand-subtitle mt-2">
          Enter your score predictions for the selected gameweek.
        </p>
      </header>

      {params.error ? (
        <p className="brand-alert-danger mb-4">
          {params.error}
        </p>
      ) : null}

      <PredictionsLivePanel
        key={`${selectedGameweek?.id ?? "none"}-${
          userHasSavedOpenPredictions ? "saved" : "editing"
        }-${params.saved ? "toast" : "quiet"}`}
        action={savePredictions}
        selectedGameweekId={selectedGameweek?.id ?? ""}
        currentUserId={user!.id}
        leaderboardEntry={leaderboardEntry as LeaderboardSummary}
        jokersLeft={jokersLeft}
        showWeeklyPoints
        initialLiveWeeklyPoints={
          hasLiveGameweekPoints ? liveGameweekPoints : null
        }
        initialLiveFixtureCount={liveFixtureCount}
        hasOpenPredictionFixtures={hasOpenPredictionFixtures}
        initialSaved={userHasSavedOpenPredictions}
        showSavedToast={Boolean(params.saved)}
        fixtures={fixtureListWithPositions}
        externalScores={Object.fromEntries(externalScoreByFixtureId)}
        predictionsByFixture={Object.fromEntries(predictionsByFixture)}
        jokerPredictionKeys={[...jokerPredictionKeys]}
        ownJokerFixtureIds={[...ownJokerFixtureIds]}
        isDoubleGameweek={isDoubleGameweek}
        predictionReactionsByKey={Object.fromEntries(predictionReactionsByKey)}
        teamFormByFixture={Object.fromEntries(formByFixture)}
      >
        <GameweekSelector
          gameweeks={gameweekList}
          selectedGameweekId={selectedGameweek?.id ?? null}
          basePath="/predictions"
        />

        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-black tracking-tight">
              {selectedGameweek?.name ||
                (selectedGameweek
                  ? `Gameweek ${selectedGameweek.gameweek_number}`
                  : "No gameweek")}
            </h2>
            {isDoubleGameweek ? (
              <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-200">
                Double Gameweek
              </span>
            ) : null}
          </div>
          <p className="text-sm text-slate-400">
            {isDoubleGameweek
              ? "All points count 2x. Jokers can’t be used during a Double Gameweek."
              : "Predictions lock individually at kickoff."}
          </p>
        </div>

        {!activeSeason ? (
          <p className="brand-alert-warning">
            This league has no active season. Predictions remain unavailable
            until a platform admin starts the next season.
          </p>
        ) : null}

        {activeSeason && gameweekList.length === 0 ? (
          <p className="brand-card-soft p-4 text-sm text-slate-400">
            No gameweeks have been created for the active season yet.
          </p>
        ) : null}

        {fixturesError ? (
          <p className="brand-alert-danger">
            Could not load fixtures. Please try again shortly.
          </p>
        ) : null}

        {predictionsError ? (
          <p className="brand-alert-danger mt-3">
            Could not load predictions. Please try again shortly.
          </p>
        ) : null}

        {jokerUsageError ? (
          <p className="brand-alert-danger mt-3">
            Could not load Joker usage. Please try again shortly.
          </p>
        ) : null}

        {activeSeason &&
        gameweekList.length > 0 &&
        !fixturesError &&
        (!fixtures || fixtures.length === 0) ? (
          <p className="brand-card-soft p-4 text-sm text-slate-400">
            No fixtures have been selected for this gameweek yet.
          </p>
        ) : null}
      </PredictionsLivePanel>
    </>
  );
}
