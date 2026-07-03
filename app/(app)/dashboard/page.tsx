export const dynamic = "force-dynamic";

import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getActiveSeason } from "@/utils/seasons";
import LeagueActivityFeed from "@/components/activity/LeagueActivityFeed";

type NotificationRow = {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type PickerGameweekRow = {
  id: string;
  gameweek_number: number;
  name: string | null;
  season_id: string;
};

type FixtureStatusRow = {
  status: string;
};

type FixtureRow = {
  id: string;
  kickoff_at: string;
  status: string;
};

type PredictionRow = {
  fixture_id: string;
};

type LatestGameweekRow = {
  id: string;
  gameweek_number: number;
  name: string | null;
  fixtures: { id: string }[];
};

type PickerGameweekStatus = PickerGameweekRow & {
  isUnlocked: boolean;
  fixtureCount: number;
  hasPredictions: boolean;
  isClosed: boolean;
};

function isTerminalFixtureStatus(status: string) {
  return ["completed", "postponed", "void"].includes(status);
}

async function isPreviousGameweekComplete({
  supabase,
  seasonId,
  gameweekNumber,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  seasonId: string;
  gameweekNumber: number;
}) {
  if (gameweekNumber === 1) {
    return true;
  }

  const { data: previousGameweek } = await supabase
    .from("gameweeks")
    .select("id")
    .eq("season_id", seasonId)
    .eq("gameweek_number", gameweekNumber - 1)
    .maybeSingle();

  if (!previousGameweek) {
    return false;
  }

  const { data: previousFixtures } = await supabase
    .from("fixtures")
    .select("status")
    .eq("gameweek_id", previousGameweek.id);

  const fixtureList = (previousFixtures as FixtureStatusRow[] | null) ?? [];

  return (
    fixtureList.length > 0 &&
    fixtureList.every((fixture) => isTerminalFixtureStatus(fixture.status))
  );
}

async function getPickerGameweekStatus({
  supabase,
  gameweek,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  gameweek: PickerGameweekRow;
}): Promise<PickerGameweekStatus> {
  const isUnlocked = await isPreviousGameweekComplete({
    supabase,
    seasonId: gameweek.season_id,
    gameweekNumber: gameweek.gameweek_number,
  });

  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("id, status")
    .eq("gameweek_id", gameweek.id);

  const fixtureRows =
    (fixtures as { id: string; status: string }[] | null) ?? [];
  const fixtureIds = fixtureRows.map((fixture) => fixture.id);

  const { data: existingPrediction } =
    fixtureIds.length > 0
      ? await supabase
          .from("predictions")
          .select("fixture_id")
          .in("fixture_id", fixtureIds)
          .limit(1)
          .maybeSingle()
      : { data: null };

  return {
    ...gameweek,
    isUnlocked,
    fixtureCount: fixtureRows.length,
    hasPredictions: Boolean(existingPrediction),
    isClosed:
      fixtureRows.length > 0 &&
      fixtureRows.every((fixture) => isTerminalFixtureStatus(fixture.status)),
  };
}

function formatGameweekName(gameweek: {
  gameweek_number: number;
  name: string | null;
}) {
  return gameweek.name || `Gameweek ${gameweek.gameweek_number}`;
}

export default async function HomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: activeSeason } = await getActiveSeason(supabase, "id");

  const { data: pickerGameweeks } =
    user && activeSeason
      ? await supabase
          .from("gameweeks")
          .select("id, gameweek_number, name, season_id")
          .eq("season_id", activeSeason.id)
          .eq("fixture_picker_id", user.id)
          .order("gameweek_number", { ascending: true })
      : { data: null };

  const assignedPickerGameweeks =
    (pickerGameweeks as PickerGameweekRow[] | null) ?? [];

  const pickerStatuses: PickerGameweekStatus[] = [];

  for (const gameweek of assignedPickerGameweeks) {
    pickerStatuses.push(
      await getPickerGameweekStatus({
        supabase,
        gameweek,
      }),
    );
  }

  const activePickerGameweek =
    pickerStatuses.find(
      (gameweek) =>
        gameweek.isUnlocked &&
        !gameweek.hasPredictions &&
        !gameweek.isClosed &&
        gameweek.fixtureCount < 4,
    ) ?? null;

  const submittedPickerGameweek =
    pickerStatuses.find(
      (gameweek) =>
        gameweek.isUnlocked &&
        !gameweek.hasPredictions &&
        !gameweek.isClosed &&
        gameweek.fixtureCount >= 4,
    ) ?? null;

  const lockedPickerGameweek =
    pickerStatuses.find(
      (gameweek) => gameweek.isUnlocked && gameweek.hasPredictions,
    ) ?? null;

  const nextFuturePickerGameweek =
    pickerStatuses.find((gameweek) => !gameweek.isUnlocked) ?? null;

  const { count: activeGameweekCount } = activeSeason
    ? await supabase
        .from("gameweeks")
        .select("id", { count: "exact", head: true })
        .eq("season_id", activeSeason.id)
    : { count: 0 };

  const { data: latestGameweekWithFixtures } = activeSeason
    ? await supabase
        .from("gameweeks")
        .select(
          `
          id,
          gameweek_number,
          name,
          fixtures!inner (
            id
          )
        `,
        )
        .eq("season_id", activeSeason.id)
        .order("gameweek_number", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const latestGameweek =
    (latestGameweekWithFixtures as LatestGameweekRow | null) ?? null;

  const { data: latestFixtures } = latestGameweek
    ? await supabase
        .from("fixtures")
        .select("id, kickoff_at, status")
        .eq("gameweek_id", latestGameweek.id)
        .order("kickoff_at", { ascending: true })
    : { data: null };

  const fixtureList = (latestFixtures as FixtureRow[] | null) ?? [];
  const fixtureIds = fixtureList.map((fixture) => fixture.id);

  const latestGameweekComplete =
    fixtureList.length > 0 &&
    fixtureList.every((fixture) => isTerminalFixtureStatus(fixture.status));

  const { data: userPredictions } =
    user && fixtureIds.length > 0
      ? await supabase
          .from("predictions")
          .select("fixture_id")
          .eq("user_id", user.id)
          .in("fixture_id", fixtureIds)
      : { data: null };

  const predictionList = (userPredictions as PredictionRow[] | null) ?? [];
  const fixtureCount = fixtureList.length;
  const now = new Date();
  const actionablePredictionFixtures = fixtureList.filter(
    (fixture) =>
      fixture.status === "scheduled" && new Date(fixture.kickoff_at) > now,
  );
  const actionableFixtureIds = new Set(
    actionablePredictionFixtures.map((fixture) => fixture.id),
  );
  const actionablePredictionCount = predictionList.filter((prediction) =>
    actionableFixtureIds.has(prediction.fixture_id),
  ).length;
  const actionableFixtureCount = actionablePredictionFixtures.length;
  const hasActionablePredictionFixtures = actionableFixtureCount > 0;
  const isPredictionComplete =
    hasActionablePredictionFixtures &&
    actionablePredictionCount >= actionableFixtureCount;

  const nextKickoff =
    actionablePredictionFixtures.length > 0
      ? new Date(actionablePredictionFixtures[0].kickoff_at)
      : null;

  const hoursUntilNextKickoff = nextKickoff
    ? Math.ceil((nextKickoff.getTime() - now.getTime()) / (1000 * 60 * 60))
    : null;

  const { data: notifications } = activeSeason
    ? await supabase
        .from("notifications")
        .select("id, type, title, body, created_at, metadata")
        .eq("season_id", activeSeason.id)
        .order("created_at", { ascending: false })
        .limit(10)
    : { data: [] };

  const notificationList = (notifications as NotificationRow[] | null) ?? [];

  return (
    <>
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Home</h1>
        <p className="mt-2 text-sm text-slate-400">
          Your league hub: actions, updates and recent activity.
        </p>
      </header>

      <section className="space-y-4">
        {activePickerGameweek ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="text-sm font-semibold text-amber-300">
              You’re up next
            </p>
            <h2 className="mt-1 text-xl font-bold">
              Pick fixtures for {formatGameweekName(activePickerGameweek)}
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              You’ve selected {activePickerGameweek.fixtureCount}/4 fixtures.
              Choose four fixtures for your assigned gameweek.
            </p>

            <Link
              href={`/pick-fixtures?gameweek=${activePickerGameweek.id}`}
              prefetch={false}
              className="mt-4 inline-flex rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950"
            >
              Pick fixtures
            </Link>
          </div>
        ) : null}

        {!activePickerGameweek && submittedPickerGameweek ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <p className="text-sm font-semibold text-emerald-300">
              Fixtures submitted
            </p>
            <h2 className="mt-1 text-xl font-bold">
              You picked fixtures for {formatGameweekName(submittedPickerGameweek)}
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              Your four fixtures are in. You can still make changes until
              someone enters predictions.
            </p>

            <Link
              href={`/pick-fixtures?gameweek=${submittedPickerGameweek.id}`}
              prefetch={false}
              className="mt-4 inline-flex rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950"
            >
              Review fixtures
            </Link>
          </div>
        ) : null}

        {!activePickerGameweek &&
          !submittedPickerGameweek &&
          nextFuturePickerGameweek ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <p className="text-sm font-semibold text-slate-300">Your next pick</p>
              <h2 className="mt-1 text-xl font-bold">
                You’re scheduled for {formatGameweekName(nextFuturePickerGameweek)}
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                You’ll be able to pick fixtures once the previous gameweek has been
                completed.
              </p>
            </div>
          ) : null}

          {!activePickerGameweek &&
          !submittedPickerGameweek &&
          !nextFuturePickerGameweek &&
          lockedPickerGameweek ? (
            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
              <p className="text-sm font-semibold text-slate-300">Fixtures locked</p>
              <h2 className="mt-1 text-xl font-bold">
                {formatGameweekName(lockedPickerGameweek)} fixtures are locked
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                Predictions have been entered, so the fixture selection is now locked. Ask
                an admin if anything needs to change.
              </p>
            </div>
          ) : null}

        {!activeSeason ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="text-sm font-semibold text-amber-300">
              No active season
            </p>
            <h2 className="mt-1 text-xl font-bold">Season setup is pending</h2>
            <p className="mt-2 text-sm text-slate-300">
              There is no live season yet. Predictions and fixture picking will
              appear here once an admin activates a season.
            </p>
          </div>
        ) : latestGameweek ? (
          !hasActionablePredictionFixtures ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <p className="text-sm font-semibold text-emerald-300">
                {latestGameweekComplete ? "Gameweek complete" : "Predictions locked"}
              </p>
              <h2 className="mt-1 text-xl font-bold">
                {formatGameweekName(latestGameweek)}
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                {latestGameweekComplete
                  ? `${formatGameweekName(
                      latestGameweek,
                    )} is complete. Check the results and see how everyone scored.`
                  : "There are no open fixtures accepting predictions for this gameweek. You can review the locked fixtures and predictions."}
              </p>

              <Link
                href={`/predictions?gameweek=${latestGameweek.id}`}
                prefetch={false}
                className="mt-4 inline-flex rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950"
              >
                {latestGameweekComplete ? "View results" : "Review predictions"}
              </Link>
            </div>
          ) : isPredictionComplete ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <p className="text-sm font-semibold text-emerald-300">
                You’re all set
              </p>
              <h2 className="mt-1 text-xl font-bold">
                {latestGameweekComplete
                  ? `${formatGameweekName(latestGameweek)} complete`
                  : `Predictions complete for ${formatGameweekName(latestGameweek)}`}
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                {latestGameweekComplete
                  ? `${formatGameweekName(
                      latestGameweek,
                    )} is complete. Check the results and see how everyone scored.`
                  : `You’ve entered all ${fixtureCount} predictions. You can review or edit them until each fixture kicks off.`}
              </p>

              <Link
                href={`/predictions?gameweek=${latestGameweek.id}`}
                prefetch={false}
                className="mt-4 inline-flex rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950"
              >
                {latestGameweekComplete ? "View results" : "Review predictions"}
              </Link>
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-sm font-semibold text-amber-300">
                Predictions
              </p>
              <h2 className="mt-1 text-xl font-bold">
                {actionablePredictionCount > 0
                  ? "Predictions in progress"
                  : `Enter predictions for ${formatGameweekName(
                      latestGameweek,
                    )}`}
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                {actionablePredictionCount > 0
                  ? `You’ve entered ${actionablePredictionCount}/${actionableFixtureCount} open predictions for ${formatGameweekName(
                      latestGameweek,
                    )}.`
                  : `You haven’t entered predictions for ${formatGameweekName(
                      latestGameweek,
                    )} yet.`}
                {hoursUntilNextKickoff !== null &&
                hoursUntilNextKickoff > 0 &&
                hoursUntilNextKickoff <= 24
                  ? ` First kickoff is in about ${hoursUntilNextKickoff} hours.`
                  : ""}
              </p>

              <Link
                href={`/predictions?gameweek=${latestGameweek.id}`}
                prefetch={false}
                className="mt-4 inline-flex rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950"
              >
                {actionablePredictionCount > 0
                  ? "Finish predictions"
                  : "Go to predictions"}
              </Link>
            </div>
          )
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-sm font-semibold text-slate-300">
              {(activeGameweekCount ?? 0) === 0
                ? "No gameweeks yet"
                : "No fixtures yet"}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              {(activeGameweekCount ?? 0) === 0
                ? "The active season has not had gameweeks generated yet."
                : "Fixtures have not been selected for the next gameweek yet."}
            </p>
          </div>
        )}
      </section>

      <LeagueActivityFeed notifications={notificationList} />
    </>
  );
}
