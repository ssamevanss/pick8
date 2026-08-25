export type Pick8MatchdayGenerationRow = {
  matchday_number: number;
  status: string;
  fixture_sync_mode: "provider" | "manual";
};

/**
 * Keeps a bounded provider-managed lookahead without requiring those matchday
 * rows to exist already. Existing manual matchdays occupy their round number
 * and are never selected for provider sync.
 */
export function getDailyFixtureSyncMatchdayNumbers(
  matchdays: Pick8MatchdayGenerationRow[],
  upcomingLookahead = 3,
) {
  if (!Number.isInteger(upcomingLookahead) || upcomingLookahead < 0) {
    throw new RangeError("Upcoming matchday lookahead must be a non-negative integer.");
  }

  const existingByNumber = new Map(
    matchdays.map((matchday) => [matchday.matchday_number, matchday]),
  );
  const progressedNumbers = matchdays
    .filter((matchday) => matchday.status !== "upcoming")
    .map((matchday) => matchday.matchday_number);
  const upcomingNumbers = matchdays
    .filter((matchday) => matchday.status === "upcoming")
    .map((matchday) => matchday.matchday_number);
  const nextAfterProgress = progressedNumbers.length
    ? Math.max(...progressedNumbers) + 1
    : 1;
  const firstUpcoming = upcomingNumbers.length
    ? Math.min(...upcomingNumbers)
    : null;
  const lookaheadStart = firstUpcoming === null
    ? nextAfterProgress
    : Math.min(firstUpcoming, nextAfterProgress);

  const selected = new Set(
    matchdays
      .filter(
        (matchday) =>
          matchday.fixture_sync_mode === "provider" &&
          ["open", "scoring"].includes(matchday.status),
      )
      .map((matchday) => matchday.matchday_number),
  );

  for (let offset = 0; offset < upcomingLookahead; offset += 1) {
    const matchdayNumber = lookaheadStart + offset;
    if (matchdayNumber > 38) break;
    const existing = existingByNumber.get(matchdayNumber);
    if (!existing || existing.fixture_sync_mode === "provider") {
      selected.add(matchdayNumber);
    }
  }

  return [...selected].sort((a, b) => a - b);
}

export function getProviderPayloadMatchday(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const value =
    record.matchday ?? record.matchday_number ?? record.matchdayNumber;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 38
    ? parsed
    : null;
}

export function representSameKickoff(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime === rightTime;
}
