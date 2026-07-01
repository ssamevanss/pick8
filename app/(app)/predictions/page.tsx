export const dynamic = "force-dynamic";

import DashboardSummary from "@/components/dashboard/DashboardSummary";
import GameweekSelector from "@/components/gameweeks/GameweekSelector";
import FixturePredictionCard from "@/components/predictions/FixturePredictionCard";
import type {
  Fixture,
  Gameweek,
  JokerUsage,
  LeaderboardSummary,
  Prediction,
} from "@/components/predictions/types";
import { createClient } from "@/utils/supabase/server";
import { getActiveSeason } from "@/utils/seasons";
import { savePredictions } from "./actions";
import SubmitButton from "@/components/forms/SubmitButton";

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
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Predictions
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Enter your score predictions for the selected gameweek.
        </p>
      </header>

      {params.saved ? (
        <p className="mb-4 rounded-xl bg-emerald-950 p-3 text-sm text-emerald-300">
          Predictions saved.
        </p>
      ) : null}

      {params.error ? (
        <p className="mb-4 rounded-xl bg-red-950 p-3 text-sm text-red-300">
          {params.error}
        </p>
      ) : null}

      <DashboardSummary
        leaderboardEntry={leaderboardEntry as LeaderboardSummary}
        jokersLeft={jokersLeft}
      />

      <section className="mt-8 rounded-2xl bg-slate-900 p-4 shadow-lg">
        <GameweekSelector
          gameweeks={gameweekList}
          selectedGameweekId={selectedGameweek?.id ?? null}
          basePath="/predictions"
        />

        <div className="mb-4">
          <h2 className="text-xl font-semibold">
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
          <p className="rounded-xl bg-amber-950 p-4 text-sm text-amber-300">
            No active season is available yet. Predictions will open once an
            admin activates a season.
          </p>
        ) : null}

        {activeSeason && gameweekList.length === 0 ? (
          <p className="rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
            No gameweeks have been created for the active season yet.
          </p>
        ) : null}

        {fixturesError ? (
          <p className="rounded-xl bg-red-950 p-4 text-sm text-red-300">
            Could not load fixtures. Please try again shortly.
          </p>
        ) : null}

        {predictionsError ? (
          <p className="mt-3 rounded-xl bg-red-950 p-4 text-sm text-red-300">
            Could not load predictions. Please try again shortly.
          </p>
        ) : null}

        {jokerUsageError ? (
          <p className="mt-3 rounded-xl bg-red-950 p-4 text-sm text-red-300">
            Could not load Joker usage. Please try again shortly.
          </p>
        ) : null}

        {activeSeason &&
        gameweekList.length > 0 &&
        !fixturesError &&
        (!fixtures || fixtures.length === 0) ? (
          <p className="rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
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
                />
            ))}

          {hasOpenPredictionFixtures ? (
            <SubmitButton
              idleLabel="Save open predictions"
              pendingLabel="Saving predictions..."
              className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950"
            />
          ) : null}
        </form>
      </section>
    </>
  );
}
