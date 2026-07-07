"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import DashboardSummary from "@/components/dashboard/DashboardSummary";
import FixturePredictionCard from "@/components/predictions/FixturePredictionCard";
import PredictionFormShell from "@/components/predictions/PredictionFormShell";
import { isLiveExternalStatus } from "@/utils/provisional-scoring";
import type {
  ExternalFixtureScore,
  Fixture,
  FixtureTeamForm,
  LeaderboardSummary,
  Prediction,
  ReactionSummary,
} from "./types";

type LiveSummaryResponse = {
  gameweek_id: string;
  should_poll: boolean;
  next_interval_ms: number;
  last_updated_at: string;
  fixtures: Fixture[];
  external_scores: Record<string, ExternalFixtureScore>;
  predictions_by_fixture: Record<string, Prediction[]>;
  leaderboard_entry: LeaderboardSummary;
  live_weekly_points: number | null;
  live_fixture_count: number;
};

type PredictionsLivePanelProps = {
  action: (formData: FormData) => void | Promise<void>;
  selectedGameweekId: string;
  currentUserId: string;
  leaderboardEntry: LeaderboardSummary;
  jokersLeft: number;
  showWeeklyPoints: boolean;
  initialLiveWeeklyPoints: number | null;
  initialLiveFixtureCount: number;
  hasOpenPredictionFixtures: boolean;
  initialSaved: boolean;
  showSavedToast: boolean;
  fixtures: Fixture[];
  externalScores: Record<string, ExternalFixtureScore>;
  predictionsByFixture: Record<string, Prediction[]>;
  jokerPredictionKeys: string[];
  ownJokerFixtureIds: string[];
  isDoubleGameweek: boolean;
  predictionReactionsByKey: Record<string, ReactionSummary[]>;
  teamFormByFixture: Record<string, FixtureTeamForm>;
  children: ReactNode;
};

function isTerminalFixture(fixture: Fixture) {
  return ["completed", "postponed", "void"].includes(fixture.status);
}

function isFixtureLocked(fixture: Fixture) {
  return fixture.status !== "scheduled" || new Date(fixture.kickoff_at) <= new Date();
}

function getPollRecommendation({
  fixtures,
  externalScores,
  predictionsByFixture,
  currentUserId,
}: {
  fixtures: Fixture[];
  externalScores: Record<string, ExternalFixtureScore>;
  predictionsByFixture: Record<string, Prediction[]>;
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
      ? externalScores[fixture.external_fixture_id]
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
      const ownPrediction = (predictionsByFixture[fixture.id] ?? []).find(
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

function formatUpdatedAt(value: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export default function PredictionsLivePanel({
  action,
  selectedGameweekId,
  currentUserId,
  leaderboardEntry,
  jokersLeft,
  showWeeklyPoints,
  initialLiveWeeklyPoints,
  initialLiveFixtureCount,
  hasOpenPredictionFixtures,
  initialSaved,
  showSavedToast,
  fixtures,
  externalScores,
  predictionsByFixture,
  jokerPredictionKeys,
  ownJokerFixtureIds,
  isDoubleGameweek,
  predictionReactionsByKey,
  teamFormByFixture,
  children,
}: PredictionsLivePanelProps) {
  const [fixtureState, setFixtureState] = useState(fixtures);
  const [externalScoreState, setExternalScoreState] = useState(externalScores);
  const [predictionState, setPredictionState] = useState(predictionsByFixture);
  const [leaderboardState, setLeaderboardState] = useState(leaderboardEntry);
  const [liveWeeklyPoints, setLiveWeeklyPoints] = useState(
    initialLiveWeeklyPoints,
  );
  const [liveFixtureCount, setLiveFixtureCount] = useState(
    initialLiveFixtureCount,
  );
  const [isEditing, setIsEditing] = useState(
    hasOpenPredictionFixtures && !initialSaved,
  );
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const latestStateRef = useRef({
    fixtures: fixtureState,
    externalScores: externalScoreState,
    predictionsByFixture: predictionState,
  });

  useEffect(() => {
    latestStateRef.current = {
      fixtures: fixtureState,
      externalScores: externalScoreState,
      predictionsByFixture: predictionState,
    };
  }, [fixtureState, externalScoreState, predictionState]);

  const canPoll = Boolean(selectedGameweekId) && !isEditing;

  const currentRecommendation = useMemo(
    () =>
      getPollRecommendation({
        fixtures: fixtureState,
        externalScores: externalScoreState,
        predictionsByFixture: predictionState,
        currentUserId,
      }),
    [currentUserId, externalScoreState, fixtureState, predictionState],
  );

  const fetchLiveSummary = useCallback(async () => {
    if (!selectedGameweekId || document.visibilityState === "hidden") {
      return null;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const response = await fetch(
      `/api/predictions/live-summary?gameweek_id=${encodeURIComponent(
        selectedGameweekId,
      )}`,
      {
        cache: "no-store",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`Live summary failed with ${response.status}`);
    }

    return (await response.json()) as LiveSummaryResponse;
  }, [selectedGameweekId]);

  useEffect(() => {
    if (!canPoll || !currentRecommendation.shouldPoll) {
      return;
    }

    let cancelled = false;

    function clearTimer() {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }

    function schedule(delayMs: number) {
      clearTimer();
      timeoutRef.current = setTimeout(run, delayMs);
    }

    async function run() {
      if (cancelled || document.visibilityState === "hidden") {
        return;
      }

      try {
        const summary = await fetchLiveSummary();

        if (cancelled || !summary) {
          return;
        }

        setFixtureState(summary.fixtures);
        setExternalScoreState(summary.external_scores);
        setPredictionState(summary.predictions_by_fixture);
        setLeaderboardState(summary.leaderboard_entry);
        setLiveWeeklyPoints(summary.live_weekly_points);
        setLiveFixtureCount(summary.live_fixture_count);
        setLastUpdatedAt(summary.last_updated_at);
        setIsStale(false);

        if (summary.should_poll) {
          schedule(summary.next_interval_ms);
        }
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) {
          return;
        }

        setIsStale(true);
        const latest = latestStateRef.current;
        const fallback = getPollRecommendation({
          fixtures: latest.fixtures,
          externalScores: latest.externalScores,
          predictionsByFixture: latest.predictionsByFixture,
          currentUserId,
        });
        schedule(fallback.intervalMs);
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        clearTimer();
        abortRef.current?.abort();
        return;
      }

      void run();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    schedule(Math.min(currentRecommendation.intervalMs, 30000));

    return () => {
      cancelled = true;
      clearTimer();
      abortRef.current?.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    canPoll,
    currentRecommendation.intervalMs,
    currentRecommendation.shouldPoll,
    currentUserId,
    fetchLiveSummary,
  ]);

  const updatedText = formatUpdatedAt(lastUpdatedAt);

  return (
    <>
      <DashboardSummary
        leaderboardEntry={leaderboardState}
        jokersLeft={jokersLeft}
        showWeeklyPoints={showWeeklyPoints}
        liveWeeklyPoints={liveWeeklyPoints}
        liveFixtureCount={liveFixtureCount}
      />

      {currentRecommendation.shouldPoll && canPoll ? (
        <p className="mb-3 text-right text-[11px] font-semibold text-slate-500">
          {isStale
            ? "Live updates paused briefly"
            : updatedText
              ? `Updated ${updatedText}`
              : "Live cards update quietly"}
        </p>
      ) : null}

      <section className="brand-card mt-8 p-4 sm:p-5">
        {children}

        <PredictionFormShell
          key={`${selectedGameweekId}-${initialSaved ? "saved" : "editing"}-${
            showSavedToast ? "toast" : "quiet"
          }`}
          action={action}
          selectedGameweekId={selectedGameweekId}
          hasOpenPredictionFixtures={hasOpenPredictionFixtures}
          initialSaved={initialSaved}
          showSavedToast={showSavedToast}
          onEditingChange={setIsEditing}
        >
          {fixtureState.map((fixture) => (
            <FixturePredictionCard
              key={fixture.id}
              fixture={fixture}
              externalScore={
                fixture.external_fixture_id
                  ? externalScoreState[fixture.external_fixture_id] ?? null
                  : null
              }
              predictions={predictionState[fixture.id] ?? []}
              currentUserId={currentUserId}
              jokerPredictionKeys={jokerPredictionKeys}
              ownJokerFixtureIds={ownJokerFixtureIds}
              jokersLeft={jokersLeft}
              isDoubleGameweek={isDoubleGameweek}
              predictionReactionsByKey={predictionReactionsByKey}
              teamForm={teamFormByFixture[fixture.id] ?? { home: [], away: [] }}
            />
          ))}
        </PredictionFormShell>
      </section>
    </>
  );
}
