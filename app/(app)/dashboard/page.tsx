export const dynamic = "force-dynamic";

import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getActiveSeason } from "@/utils/seasons";
import LeagueActivityFeed from "@/components/activity/LeagueActivityFeed";
import DashboardSummary from "@/components/dashboard/DashboardSummary";
import type { ReactionSummary } from "@/components/predictions/types";
import { getFixtureSelectionStatus } from "@/utils/fixture-selection";
import {
  calculateProvisionalPredictionScore,
  isLiveExternalStatus,
} from "@/utils/provisional-scoring";

type NotificationRow = {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
  reactions?: ReactionSummary[];
  comments?: NotificationCommentRow[];
};

type NotificationCommentRow = {
  id: string;
  notification_id: string;
  user_id: string;
  body: string;
  created_at: string;
  reactions?: ReactionSummary[];
  profiles:
    | {
        display_name: string;
      }
    | {
        display_name: string;
      }[]
    | null;
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
  home_score: number | null;
  away_score: number | null;
  external_fixture_id: string | null;
};

type PredictionRow = {
  fixture_id: string;
  home_score: number;
  away_score: number;
  points: number | null;
};

type LatestGameweekRow = {
  id: string;
  gameweek_number: number;
  name: string | null;
  is_double_gameweek: boolean | null;
  fixtures: { id: string }[];
};

type PickerGameweekStatus = PickerGameweekRow & {
  isUnlocked: boolean;
  fixtureCount: number;
  expectedFixtureCount: number;
  hasPredictions: boolean;
  isClosed: boolean;
  isSelectionComplete: boolean;
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
    .select("id, status, external_provider, external_fixture_id")
    .eq("gameweek_id", gameweek.id);

  const fixtureRows =
    (fixtures as
      | {
          id: string;
          status: string;
          external_provider: string | null;
          external_fixture_id: string | null;
        }[]
      | null) ?? [];
  const fixtureIds = fixtureRows.map((fixture) => fixture.id);
  const selectionStatus = getFixtureSelectionStatus(fixtureRows);

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
    expectedFixtureCount: selectionStatus.expectedCount,
    hasPredictions: Boolean(existingPrediction),
    isSelectionComplete: selectionStatus.isComplete,
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

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ activity?: string; comments?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  const { data: activeSeason } = await getActiveSeason(supabase, "id, name");

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
        !gameweek.isSelectionComplete,
    ) ?? null;

  const submittedPickerGameweek =
    pickerStatuses.find(
      (gameweek) =>
        gameweek.isUnlocked &&
        !gameweek.hasPredictions &&
        !gameweek.isClosed &&
        gameweek.isSelectionComplete,
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
          is_double_gameweek,
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
        .select(
          "id, kickoff_at, status, home_score, away_score, external_fixture_id",
        )
        .eq("gameweek_id", latestGameweek.id)
        .order("kickoff_at", { ascending: true })
    : { data: null };

  const fixtureList = (latestFixtures as FixtureRow[] | null) ?? [];
  const fixtureIds = fixtureList.map((fixture) => fixture.id);
  const externalFixtureIds = fixtureList
    .map((fixture) => fixture.external_fixture_id)
    .filter((value): value is string => Boolean(value));
  const { data: externalScoreRows } =
    externalFixtureIds.length > 0
      ? await supabase
          .from("external_fixtures")
          .select("external_fixture_id, status, home_score, away_score")
          .eq("provider", "football_data")
          .in("external_fixture_id", externalFixtureIds)
      : { data: [] };
  const externalScoreByFixtureId = new Map(
    (
      (externalScoreRows as
        | {
            external_fixture_id: string;
            status: string | null;
            home_score: number | null;
            away_score: number | null;
          }[]
        | null) ?? []
    ).map((row) => [row.external_fixture_id, row]),
  );
  const currentGameweekLabel = latestGameweek
    ? formatGameweekName(latestGameweek)
    : activeSeason
      ? "Not started"
      : "-";
  const isLatestDoubleGameweek = Boolean(latestGameweek?.is_double_gameweek);

  const latestGameweekComplete =
    fixtureList.length > 0 &&
    fixtureList.every((fixture) => isTerminalFixtureStatus(fixture.status));

  const { data: userPredictions } =
    user && fixtureIds.length > 0
      ? await supabase
          .from("predictions")
          .select("fixture_id, home_score, away_score, points")
          .eq("user_id", user.id)
          .in("fixture_id", fixtureIds)
      : { data: null };

  const predictionList = (userPredictions as PredictionRow[] | null) ?? [];
  const fixtureCount = fixtureList.length;

  const { data: leaderboardEntry } =
    activeSeason && user
      ? await supabase
          .from("leaderboard_entries")
          .select("rank, total_points, weekly_points")
          .eq("season_id", activeSeason.id)
          .eq("user_id", user.id)
          .maybeSingle()
      : { data: null };

  const { data: seasonJokerUsage } =
    activeSeason && user
      ? await supabase
          .from("joker_usage")
          .select(
            `
            fixture_id,
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
  const ownJokerFixtureIds = new Set(
    (
      (seasonJokerUsage as
        | {
            fixture_id: string;
          }[]
        | null) ?? []
    ).map((joker) => joker.fixture_id),
  );
  const predictionsByFixtureId = new Map(
    predictionList.map((prediction) => [prediction.fixture_id, prediction]),
  );
  let liveGameweekPoints = 0;
  let hasLiveGameweekPoints = false;
  let liveFixtureCount = 0;

  for (const fixture of fixtureList) {
    const prediction = predictionsByFixtureId.get(fixture.id);

    if (!prediction) {
      continue;
    }

    if (fixture.status === "completed" && prediction.points !== null) {
      liveGameweekPoints += prediction.points;
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

    liveGameweekPoints += calculateProvisionalPredictionScore({
      predictionHome: prediction.home_score,
      predictionAway: prediction.away_score,
      actualHome: externalScore.home_score,
      actualAway: externalScore.away_score,
      usedJoker:
        !isLatestDoubleGameweek && ownJokerFixtureIds.has(fixture.id),
      isDoubleGameweek: isLatestDoubleGameweek,
    }).points;
    hasLiveGameweekPoints = true;
    liveFixtureCount += 1;
  }

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
  const notificationIds = notificationList.map((notification) => notification.id);

  const { data: notificationReactions } =
    notificationIds.length > 0
      ? await supabase
          .from("notification_reactions")
          .select("notification_id, user_id, emoji")
          .in("notification_id", notificationIds)
      : { data: [] };

  const { data: notificationComments } =
    notificationIds.length > 0
      ? await supabase
          .from("notification_comments")
          .select(
            `
            id,
            notification_id,
            user_id,
            body,
            created_at,
            profiles (
              display_name
            )
          `,
          )
          .in("notification_id", notificationIds)
          .order("created_at", { ascending: true })
      : { data: [] };
  const commentIds = (
    (notificationComments as NotificationCommentRow[] | null) ?? []
  ).map((comment) => comment.id);
  const { data: notificationCommentReactions } =
    commentIds.length > 0
      ? await supabase
          .from("notification_comment_reactions")
          .select("comment_id, user_id, emoji")
          .in("comment_id", commentIds)
      : { data: [] };

  const reactionsByNotification = new Map<string, ReactionSummary[]>();

  for (const reaction of
    (notificationReactions as
      | {
          notification_id: string;
          user_id: string;
          emoji: string;
        }[]
      | null) ?? []) {
    const existing = reactionsByNotification.get(reaction.notification_id) ?? [];
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

    reactionsByNotification.set(reaction.notification_id, existing);
  }

  const commentsByNotification = new Map<string, NotificationCommentRow[]>();
  const reactionsByComment = new Map<string, ReactionSummary[]>();

  for (const reaction of
    (notificationCommentReactions as
      | {
          comment_id: string;
          user_id: string;
          emoji: string;
        }[]
      | null) ?? []) {
    const existing = reactionsByComment.get(reaction.comment_id) ?? [];
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

    reactionsByComment.set(reaction.comment_id, existing);
  }

  for (const comment of
    (notificationComments as NotificationCommentRow[] | null) ?? []) {
    const existing = commentsByNotification.get(comment.notification_id) ?? [];
    existing.push({
      ...comment,
      reactions: reactionsByComment.get(comment.id) ?? [],
    });
    commentsByNotification.set(comment.notification_id, existing);
  }

  const notificationListWithSocial = notificationList.map((notification) => ({
    ...notification,
    reactions: reactionsByNotification.get(notification.id) ?? [],
    comments: commentsByNotification.get(notification.id) ?? [],
  }));

  return (
    <>
      <header className="brand-card mb-4 overflow-hidden p-4 sm:p-5">
        <p className="brand-eyebrow">League hub</p>
        <div className="mt-2 max-w-3xl">
          <h1 className="brand-title">Who You Got?</h1>
          <p className="brand-subtitle mt-2">
            {activeSeason?.name
              ? `${activeSeason.name}: make your calls, track your position, and follow the league.`
              : "Your private football prediction league will open once a season is live."}
          </p>
        </div>
      </header>

      <DashboardSummary
        leaderboardEntry={leaderboardEntry}
        jokersLeft={jokersLeft}
        currentGameweekLabel={currentGameweekLabel}
      />

      {hasLiveGameweekPoints ? (
        <div className="brand-card mb-3 border-emerald-300/25 bg-emerald-300/10 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-emerald-200">
              Live GW points
            </p>
            <p className="mt-1 text-sm text-slate-300">
              {liveGameweekPoints} as it stands from {liveFixtureCount} live
              fixture{liveFixtureCount === 1 ? "" : "s"}. Official points
              update after full time.
            </p>
          </div>
          <Link
            href={latestGameweek ? `/predictions?gameweek=${latestGameweek.id}` : "/predictions"}
            prefetch={false}
            className="brand-button-secondary mt-3 shrink-0 sm:mt-0"
          >
            View live picks
          </Link>
        </div>
      ) : null}

      <section className="space-y-3">
        {!activeSeason ? (
          <div className="brand-alert-warning">
            <p className="text-sm font-semibold text-amber-300">No active season</p>
            <h2 className="mt-1 text-lg font-bold sm:text-xl">
              Season setup is pending
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              There is no live season yet. Predictions and fixture picking will
              appear here once an admin activates a season.
            </p>
          </div>
        ) : latestGameweek ? (
          !hasActionablePredictionFixtures ? (
            <div className="brand-card border-emerald-400/30 bg-emerald-400/10 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-emerald-300">
                  {latestGameweekComplete ? "Gameweek complete" : "Predictions locked"}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold sm:text-xl">
                    {formatGameweekName(latestGameweek)}
                  </h2>
                  {isLatestDoubleGameweek ? (
                    <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-200">
                      Double GW
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-slate-300">
                  {latestGameweekComplete
                    ? `${formatGameweekName(
                        latestGameweek,
                      )} is complete. Check the results and see how everyone scored.`
                    : "There are no open fixtures accepting predictions for this gameweek. You can review the locked fixtures and predictions."}
                </p>
              </div>
              <Link
                href={`/predictions?gameweek=${latestGameweek.id}`}
                prefetch={false}
                className="brand-button-primary mt-4 shrink-0 sm:mt-0"
              >
                {latestGameweekComplete ? "View results" : "Review predictions"}
              </Link>
            </div>
          ) : isPredictionComplete ? (
            <div className="brand-card border-emerald-400/30 bg-emerald-400/10 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-emerald-300">
                  Predictions saved
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold sm:text-xl">
                    {latestGameweekComplete
                      ? `${formatGameweekName(latestGameweek)} complete`
                      : `Predictions complete for ${formatGameweekName(latestGameweek)}`}
                  </h2>
                  {isLatestDoubleGameweek ? (
                    <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-200">
                      Double GW
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-slate-300">
                  {latestGameweekComplete
                    ? `${formatGameweekName(
                        latestGameweek,
                      )} is complete. Check the results and see how everyone scored.`
                    : `You’ve entered all ${fixtureCount} predictions. You can review or edit them until each fixture kicks off.`}
                </p>
              </div>
              <Link
                href={`/predictions?gameweek=${latestGameweek.id}`}
                prefetch={false}
                className="brand-button-primary mt-4 shrink-0 sm:mt-0"
              >
                {latestGameweekComplete ? "View results" : "Review predictions"}
              </Link>
            </div>
          ) : (
            <div className="brand-card border-amber-300/30 bg-amber-300/10 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-300">
                  Predictions open
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold sm:text-xl">
                    Make your predictions for {formatGameweekName(latestGameweek)}
                  </h2>
                  {isLatestDoubleGameweek ? (
                    <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-200">
                      Double GW
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-slate-300">
                  {actionablePredictionCount > 0
                    ? `You’ve entered ${actionablePredictionCount}/${actionableFixtureCount} open predictions.`
                    : "You haven’t entered predictions yet."}
                  {hoursUntilNextKickoff !== null &&
                  hoursUntilNextKickoff > 0 &&
                  hoursUntilNextKickoff <= 24
                    ? ` First kickoff is in about ${hoursUntilNextKickoff} hours.`
                    : ""}
                </p>
              </div>
              <Link
                href={`/predictions?gameweek=${latestGameweek.id}`}
                prefetch={false}
                className="brand-button-gold mt-4 shrink-0 sm:mt-0"
              >
                {actionablePredictionCount > 0
                  ? "Finish predictions"
                  : "Make your predictions"}
              </Link>
            </div>
          )
        ) : (
          <div className="brand-card p-4">
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

        {activePickerGameweek ? (
          <div className="brand-card border-amber-300/30 bg-amber-300/10 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-300">Your turn to pick</p>
              <h2 className="mt-1 text-lg font-bold sm:text-xl">
                You’re picking fixtures for {formatGameweekName(activePickerGameweek)}
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                You’ve selected {activePickerGameweek.fixtureCount}/
                {activePickerGameweek.expectedFixtureCount} fixtures.
              </p>
            </div>

            <Link
              href={`/pick-fixtures?gameweek=${activePickerGameweek.id}`}
              prefetch={false}
              className="brand-button-gold mt-4 shrink-0 sm:mt-0"
            >
              Pick fixtures
            </Link>
          </div>
        ) : null}

        {!activePickerGameweek && submittedPickerGameweek ? (
          <div className="brand-card border-emerald-400/30 bg-emerald-400/10 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-emerald-300">
                Fixtures submitted
              </p>
              <h2 className="mt-1 text-lg font-bold sm:text-xl">
                You picked fixtures for {formatGameweekName(submittedPickerGameweek)}
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                Your {submittedPickerGameweek.fixtureCount} fixture
                {submittedPickerGameweek.fixtureCount === 1 ? " is" : "s are"} in.
                You can still make changes until someone enters predictions.
              </p>
            </div>

            <Link
              href={`/pick-fixtures?gameweek=${submittedPickerGameweek.id}`}
              prefetch={false}
              className="brand-button-primary mt-4 shrink-0 sm:mt-0"
            >
              Review fixtures
            </Link>
          </div>
        ) : null}

        {!activePickerGameweek &&
        !submittedPickerGameweek &&
        nextFuturePickerGameweek ? (
          <div className="brand-card p-4">
            <p className="text-sm font-semibold text-slate-300">Your next pick</p>
            <h2 className="mt-1 text-lg font-bold sm:text-xl">
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
          <div className="brand-card p-4">
            <p className="text-sm font-semibold text-slate-300">Fixtures locked</p>
            <h2 className="mt-1 text-lg font-bold sm:text-xl">
              {formatGameweekName(lockedPickerGameweek)} fixtures are locked
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Predictions have been entered, so the fixture selection is now locked. Ask
              an admin if anything needs to change.
            </p>
          </div>
        ) : null}
      </section>

      {user ? (
        <LeagueActivityFeed
          notifications={notificationListWithSocial}
          currentUserId={user.id}
          canModerate={profile?.role === "admin"}
          highlightedActivityId={params.activity ?? null}
          openCommentsForActivityId={
            params.comments === "1" ? params.activity ?? null : null
          }
        />
      ) : null}
    </>
  );
}
