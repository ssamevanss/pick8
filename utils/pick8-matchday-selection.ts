export type SelectablePick8Matchday = {
  matchday_number: number;
  status: string;
  locks_at: string | null;
};

export function resolveDefaultPicksMatchday<
  T extends SelectablePick8Matchday,
>(matchdays: T[], now: number) {
  const ordered = [...matchdays].sort(
    (a, b) => a.matchday_number - b.matchday_number,
  );
  return (
    ordered.find((matchday) => matchday.status === "open") ??
    ordered.find(
      (matchday) =>
        matchday.status === "upcoming" &&
        matchday.locks_at !== null &&
        new Date(matchday.locks_at).getTime() > now,
    ) ??
    [...ordered]
      .reverse()
      .find((matchday) => ["completed", "scoring"].includes(matchday.status)) ??
    null
  );
}
