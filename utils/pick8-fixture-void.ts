// Permanent void settlement for postponed and replayed fixtures.
//
// The decision is made in Postgres (`decide_pick8_fixture_void`, in the same statement that stores the
// provider's data) so it cannot be skipped or lost. This module is its TypeScript mirror: the sync uses it to
// predict the matchday lifecycle before the write, and tests compare it with the real trigger.
// Keep the two identical. Policy and rationale: docs/permanent-void-settlement.md.

export type VoidReason = "postponed" | "rescheduled" | "abandoned" | "manual";

/** Statuses a started or finished match can be in: a kickoff change on these is never a reschedule. */
const STARTED_STATUSES = new Set(["in_play", "paused", "finished"]);

const LONDON_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar day of an instant in Europe/London, the venue time zone of every Premier League match. */
export function londonDay(instant: string | number) {
  const value = typeof instant === "number" ? instant : Date.parse(instant);
  return Number.isFinite(value) ? LONDON_DAY.format(new Date(value)) : null;
}

export type VoidDecisionFixture = { status: string; kickoff_at: string };

/**
 * Decides whether a provider update permanently voids a fixture that is not void yet.
 *
 * - `postponed`: the provider reports the match postponed and it had not started.
 * - `rescheduled` / `abandoned`: once the entry deadline has passed, a match that had not started
 *   moves to a later calendar day. A shorter move (a delayed kickoff the same day) is the same
 *   scheduled match and never voids it. `abandoned` when the match had been abandoned (a replay).
 * - Moves before the entry deadline are not decided: entries can still be revised.
 * - A started or finished match is never voided by a kickoff change.
 */
export function decideFixtureVoid({
  previous,
  next,
  entryDeadlineElapsed,
}: {
  previous: VoidDecisionFixture | null;
  next: VoidDecisionFixture;
  entryDeadlineElapsed: boolean;
}): VoidReason | null {
  if (next.status === "postponed" && (!previous || !STARTED_STATUSES.has(previous.status))) {
    return "postponed";
  }
  if (!previous || STARTED_STATUSES.has(previous.status) || !entryDeadlineElapsed) return null;
  const before = Date.parse(previous.kickoff_at);
  const after = Date.parse(next.kickoff_at);
  if (!(after > before)) return null;
  const beforeDay = londonDay(before);
  const afterDay = londonDay(after);
  if (beforeDay === null || afterDay === null || afterDay <= beforeDay) return null;
  return previous.status === "abandoned" ? "abandoned" : "rescheduled";
}

/**
 * The status the game should act on: a permanently voided fixture is `postponed` whatever the provider
 * mirror now says (a new kickoff, a replay in progress, a replayed score).
 */
export function effectiveFixtureStatus(fixture: { status: string; voided_at?: string | null }) {
  return fixture.voided_at ? "postponed" : fixture.status;
}

/** Applies `effectiveFixtureStatus` to rows read for display or scoring. */
export function withEffectiveFixtureStatus<T extends { status: string; voided_at?: string | null }>(fixtures: T[]) {
  return fixtures.map(({ voided_at, ...fixture }) => ({
    ...fixture,
    status: effectiveFixtureStatus({ status: fixture.status, voided_at }),
  }));
}
