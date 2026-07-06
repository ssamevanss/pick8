export const dynamic = "force-dynamic";

import DashboardSummary from "@/components/dashboard/DashboardSummary";
import GameweekSelector from "@/components/gameweeks/GameweekSelector";
import FixturePredictionCard from "@/components/predictions/FixturePredictionCard";
import type {
  Fixture,
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
import SubmitButton from "@/components/forms/SubmitButton";

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
        .select("id, gameweek_number, name")
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

  const { data: fixtures, error: fixturesError } = selectedGameweek
    ? await supabase
        .from("fixtures")
        .select(
          "id, gameweek_id, home_team, away_team, kickoff_at, competition, status, home_score, away_score",
        )
        .eq("gameweek_id", selectedGameweek.id)
        .order("kickoff_at", { ascending: true })
    : { data: null, error: null };

  const fixtureIds = ((fixtures as Fixture[] | null) ?? []).map(
    (fixture) => fixture.id,
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

  const fixtureList = (fixtures as Fixture[] | null) ?? [];
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

  const jokerRows = (jokerUsage as JokerUsage[] | null) ?? [];

  const ownJokerFixtureIds = new Set(
    jokerRows
      .filter((joker) => joker.user_id === user?.id)
      .map((joker) => joker.fixture_id),
  );

  const jokerPredictionKeys = new Set(
    jokerRows.map((joker) => `${joker.fixture_id}:${joker.user_id}`),
  );

  const jokersUsed = ownJokerFixtureIds.size;
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

      {params.saved ? (
        <p className="brand-alert-success mb-4">
          Predictions saved.
        </p>
      ) : null}

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
          <h2 className="text-2xl font-black tracking-tight">
            {selectedGameweek?.name ||
              (selectedGameweek
                ? `Gameweek ${selectedGameweek.gameweek_number}`
                : "No gameweek")}
          </h2>
          <p className="text-sm text-slate-400">
            Predictions lock individually at kickoff.
          </p>
        </div>

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

        <form action={savePredictions} className="space-y-3">
            <input
                type="hidden"
                name="selected_gameweek_id"
                value={selectedGameweek?.id ?? ""}
            />

            {fixtureList.map((fixture) => (
                <FixturePredictionCard
                key={fixture.id}
                fixture={fixture}
                predictions={predictionsByFixture.get(fixture.id) ?? []}
                currentUserId={user!.id}
                jokerPredictionKeys={jokerPredictionKeys}
                ownJokerFixtureIds={ownJokerFixtureIds}
                jokersLeft={jokersLeft}
                teamForm={
                  formByFixture.get(fixture.id) ?? { home: [], away: [] }
                }
                />
            ))}

          {hasOpenPredictionFixtures ? (
            <SubmitButton
              idleLabel="Save open predictions"
              pendingLabel="Saving predictions..."
              className="brand-button-primary w-full"
            />
          ) : null}
        </form>
      </section>
    </>
  );
}
