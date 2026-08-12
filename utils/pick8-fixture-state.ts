export const PICK8_TIME_ZONE = "Australia/Melbourne";

const LIVE_STATUSES = new Set(["in_play", "paused"]);
const FINISHED_STATUSES = new Set(["finished"]);
const VOID_STATUSES = new Set(["postponed", "cancelled"]);

export type FixtureLifecycle = "upcoming" | "locked" | "live" | "finished" | "void";

export function fixtureKickoffMs(kickoffAt: string) {
  const value = Date.parse(kickoffAt);
  return Number.isFinite(value) ? value : null;
}

export function hasFixtureKickedOff(kickoffAt: string, now = Date.now()) {
  const kickoff = fixtureKickoffMs(kickoffAt);
  return kickoff !== null && now >= kickoff;
}

export function earliestFixtureKickoff(
  fixtures: Array<{ kickoff_at: string }>,
) {
  const kickoffs = fixtures
    .map((fixture) => fixtureKickoffMs(fixture.kickoff_at))
    .filter((kickoff): kickoff is number => kickoff !== null);
  return kickoffs.length ? new Date(Math.min(...kickoffs)).toISOString() : null;
}

export function isInitialPick8EntryWindowOpen(
  matchdayStatus: string,
  locksAt: string | null,
  now = Date.now(),
) {
  const lockTime = locksAt ? fixtureKickoffMs(locksAt) : null;
  return matchdayStatus !== "completed" && lockTime !== null && now < lockTime;
}

export function getFixtureLifecycle(
  fixture: { kickoff_at: string; status: string },
  now = Date.now(),
): FixtureLifecycle {
  if (VOID_STATUSES.has(fixture.status)) return "void";
  if (FINISHED_STATUSES.has(fixture.status)) return "finished";
  if (LIVE_STATUSES.has(fixture.status)) return "live";
  return hasFixtureKickedOff(fixture.kickoff_at, now) ? "locked" : "upcoming";
}

export function isFixtureSelectionEditable(
  fixture: { kickoff_at: string; status: string },
  now = Date.now(),
) {
  return getFixtureLifecycle(fixture, now) === "upcoming";
}

export function resolveMatchdayScoringStatus({
  currentStatus,
  fixtures,
  finalScoringReady,
  now = Date.now(),
}: {
  currentStatus: string;
  fixtures: Array<{ kickoff_at: string; status: string }>;
  finalScoringReady: boolean;
  now?: number;
}) {
  if (finalScoringReady) return "completed";
  const hasStarted = fixtures.some((fixture) =>
    LIVE_STATUSES.has(fixture.status) ||
    FINISHED_STATUSES.has(fixture.status) ||
    hasFixtureKickedOff(fixture.kickoff_at, now),
  );
  if (hasStarted) return "scoring";
  return currentStatus === "upcoming" ? "upcoming" : "open";
}

export function canFinalizeBeforeConfiguredKickoffs({
  allowAcceleratedTestCompletion = false,
  fixtureSyncMode,
  isAcceleratedTest,
}: {
  allowAcceleratedTestCompletion?: boolean;
  fixtureSyncMode: string;
  isAcceleratedTest: boolean;
}) {
  return allowAcceleratedTestCompletion && fixtureSyncMode === "manual" && isAcceleratedTest;
}

export function isPick8SelectionVisible({
  viewerId,
  ownerId,
  submittedAt,
  kickoffAt,
  now = Date.now(),
}: {
  viewerId: string;
  ownerId: string;
  submittedAt: string | null;
  kickoffAt: string;
  now?: number;
}) {
  return viewerId === ownerId ||
    (submittedAt !== null && hasFixtureKickedOff(kickoffAt, now));
}

export function isSubmittedFixturePickRevealable({
  submittedAt,
  fixtureId,
  selectionFixtureId,
  kickoffAt,
  now = Date.now(),
}: {
  submittedAt: string | null;
  fixtureId: string;
  selectionFixtureId: string;
  kickoffAt: string;
  now?: number;
}) {
  return submittedAt !== null &&
    fixtureId === selectionFixtureId &&
    hasFixtureKickedOff(kickoffAt, now);
}

export function fixtureLifecycleLabel(lifecycle: FixtureLifecycle) {
  switch (lifecycle) {
    case "upcoming": return "Upcoming";
    case "locked": return "Locked · Started";
    case "live": return "Live";
    case "finished": return "Finished";
    case "void": return "Postponed / Cancelled";
  }
}

export function fixtureScoreStateLabel(lifecycle: FixtureLifecycle) {
  if (lifecycle === "live") return "LIVE";
  if (lifecycle === "finished") return "FT";
  return null;
}

export function getMatchdayGoalProgress(
  fixtures: Array<{
    kickoff_at: string;
    status: string;
    home_score: number | null;
    away_score: number | null;
  }>,
  now = Date.now(),
) {
  let hasStarted = false;
  let currentGoals = 0;

  for (const fixture of fixtures) {
    if (getFixtureLifecycle(fixture, now) === "upcoming") continue;
    hasStarted = true;
    if (fixture.home_score !== null && fixture.away_score !== null) {
      currentGoals += fixture.home_score + fixture.away_score;
    }
  }

  return { hasStarted, currentGoals };
}

export function formatPick8Kickoff(kickoffAt: string) {
  const kickoff = fixtureKickoffMs(kickoffAt);
  if (kickoff === null) return "Kickoff unavailable";
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: PICK8_TIME_ZONE,
    timeZoneName: "short",
  }).format(new Date(kickoff));
}
