export const dynamic = "force-dynamic";

import DashboardSummary from "@/components/dashboard/DashboardSummary";
import GameweekSelector from "@/components/gameweeks/GameweekSelector";
import FixturePredictionCard from "@/components/predictions/FixturePredictionCard";
import PredictionFormShell from "@/components/predictions/PredictionFormShell";
import type {
  Fixture,
  ExternalFixtureScore,
  FixtureTeamForm,
  Gameweek,
  JokerUsage,
  LeaderboardSummary,
  Prediction,
  TeamFormResult,
} from "@/components/predictions/types";
import { createClient } from "@/utils/supabase/server";
import { getActiveSeason } from "@/utils/seasons";
import { savePredictions } from "./actions";

type CompletedFixtureForForm = {
  id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  home_score: number;
  away_score: number;
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
}: {
  teamName: string;
  fixtureKickoffAt: string;
  completedFixtures: CompletedFixtureForForm[];
}) {
  return completedFixtures
    .filter(
      (fixture) =>
        fixture.kickoff_at < fixtureKickoffAt &&
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
  searchParams?: Promise<{ saved?: string; error?: string; gameweek?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: activeSeason } = await getActiveSeason(supabase, "id");

  const { data: gameweeks } = activeSeason
    ? await supabase
        .from("gameweeks")
        .select("id, gameweek_number, name, is_double_gameweek")
        .eq("season_id", activeSeason.id)
        .order("gameweek_number", { ascending: true })
    : { data: null };

  const gameweekList = (gameweeks as Gameweek[] | null) ?? [];

  const gameweekIds = gameweekList.map((gameweek) => gameweek.id);

  const { data: fixtureRows } =
    gameweekIds.length > 0
      ? await supabase
          .from("fixtures")
          .select("gameweek_id")
          .in("gameweek_id", gameweekIds)
      : { data: [] };

  const gameweekIdsWithFixtures = new Set(
    (fixtureRows ?? []).map((fixture) => fixture.gameweek_id),
  );

  const latestGameweekWithFixtures =
    [...gameweekList]
      .reverse()
      .find((gameweek) => gameweekIdsWithFixtures.has(gameweek.id)) ?? null;

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
          "id, gameweek_id, home_team, away_team, kickoff_at, competition, status, home_score, away_score, external_provider, external_fixture_id, external_status, external_last_synced_at",
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

  const { data: externalScoreRows } =
    externalFixtureIds.length > 0
      ? await supabase
          .from("external_fixtures")
          .select(
            "external_fixture_id, status, home_score, away_score, last_synced_at",
          )
          .eq("provider", "football_data")
          .in("external_fixture_id", externalFixtureIds)
      : { data: [] };
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

  const { data: predictions, error: predictionsError } =
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
      : { data: null, error: null };

  const { data: jokerUsage, error: jokerUsageError } =
    fixtureIds.length > 0
      ? await supabase
          .from("joker_usage")
          .select("fixture_id, user_id")
          .in("fixture_id", fixtureIds)
          .is("refunded_at", null)
      : { data: null, error: null };

  const { data: seasonJokerUsage } =
    activeSeason && user
      ? await supabase
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
      : { data: [] };

  const latestFixtureKickoff =
    fixtureList
      .map((fixture) => fixture.kickoff_at)
      .sort()
      .at(-1) ?? null;

  const { data: completedFormFixtures } =
    activeSeason && latestFixtureKickoff
      ? await supabase
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
      : { data: [] };
  const completedFixtureRows =
    (completedFormFixtures as CompletedFixtureForForm[] | null) ?? [];
  const formByFixture = new Map<string, FixtureTeamForm>();

  for (const fixture of fixtureList) {
    formByFixture.set(fixture.id, {
      home: getRecentTeamForm({
        teamName: fixture.home_team,
        fixtureKickoffAt: fixture.kickoff_at,
        completedFixtures: completedFixtureRows,
      }),
      away: getRecentTeamForm({
        teamName: fixture.away_team,
        fixtureKickoffAt: fixture.kickoff_at,
        completedFixtures: completedFixtureRows,
      }),
    });
  }

  const hasOpenPredictionFixtures = fixtureList.some(
    (fixture) =>
      fixture.status === "scheduled" && new Date(fixture.kickoff_at) > new Date(),
  );

  const { data: leaderboardEntry } =
    activeSeason && user
      ? await supabase
          .from("leaderboard_entries")
          .select("rank, total_points, weekly_points")
          .eq("season_id", activeSeason.id)
          .eq("user_id", user.id)
          .maybeSingle()
      : { data: null };

  const predictionsByFixture = new Map<string, Prediction[]>();

  for (const prediction of (predictions as Prediction[] | null) ?? []) {
    const existing = predictionsByFixture.get(prediction.fixture_id) ?? [];
    existing.push(prediction);
    predictionsByFixture.set(prediction.fixture_id, existing);
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

      <DashboardSummary
        leaderboardEntry={leaderboardEntry as LeaderboardSummary}
        jokersLeft={jokersLeft}
      />

      <section className="brand-card mt-8 p-4 sm:p-5">
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

        {isDoubleGameweek ? (
          <p className="brand-alert-success mb-4">
            Double Gameweek — all points count 2x.
          </p>
        ) : null}

        {!activeSeason ? (
          <p className="brand-alert-warning">
            No active season is available yet. Predictions will open once an
            admin activates a season.
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

        <PredictionFormShell
          key={`${selectedGameweek?.id ?? "none"}-${
            userHasSavedOpenPredictions ? "saved" : "editing"
          }-${params.saved ? "toast" : "quiet"}`}
          action={savePredictions}
          selectedGameweekId={selectedGameweek?.id ?? ""}
          hasOpenPredictionFixtures={hasOpenPredictionFixtures}
          initialSaved={userHasSavedOpenPredictions}
          showSavedToast={Boolean(params.saved)}
        >
          {fixtureList.map((fixture) => (
            <FixturePredictionCard
              key={fixture.id}
              fixture={fixture}
              externalScore={
                fixture.external_fixture_id
                  ? externalScoreByFixtureId.get(fixture.external_fixture_id) ?? null
                  : null
              }
              predictions={predictionsByFixture.get(fixture.id) ?? []}
              currentUserId={user!.id}
              jokerPredictionKeys={jokerPredictionKeys}
              ownJokerFixtureIds={ownJokerFixtureIds}
              jokersLeft={jokersLeft}
              isDoubleGameweek={isDoubleGameweek}
              teamForm={
                formByFixture.get(fixture.id) ?? { home: [], away: [] }
              }
            />
          ))}
        </PredictionFormShell>
      </section>
    </>
  );
}
