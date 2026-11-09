export type StandingsProfile = {
  id: string;
  display_name: string;
  is_active?: boolean;
  pick8_participation_active?: boolean;
};
export type StandingsMatchday = { id: string; matchday_number: number; status: string; locks_at: string | null; pick8_rules_version?: number };
export type StandingsCompetition = { id: string; name: string; start_matchday: number; end_matchday: number; status: string };
export type StandingsEntry = { id: string; user_id: string; matchday_id: string; submitted_at: string | null; calculated_score: number | null };

export function playerDisplayName(profile: StandingsProfile) {
  return profile.display_name.trim() || "Player";
}

export function resolveCurrentMatchday(matchdays: StandingsMatchday[], now: number) {
  const ordered = [...matchdays].sort((a, b) => a.matchday_number - b.matchday_number);
  return ordered.find((matchday) => matchday.status === "open") ?? ordered.find((matchday) => matchday.status === "upcoming" && matchday.locks_at !== null && Date.parse(matchday.locks_at) > now) ?? [...ordered].reverse().find((matchday) => ["locked", "scoring", "completed"].includes(matchday.status)) ?? null;
}

export function resolveRelevantMatchday<
  T extends Pick<StandingsMatchday, "matchday_number" | "status" | "locks_at">,
>(matchdays: T[], now: number) {
  const ordered = [...matchdays].sort(
    (a, b) => a.matchday_number - b.matchday_number,
  );
  return (
    ordered.find((matchday) => matchday.status === "scoring") ??
    ordered.find((matchday) => matchday.status === "locked") ??
    ordered.find((matchday) => matchday.status === "open") ??
    ordered.find(
      (matchday) =>
        matchday.status === "upcoming" &&
        matchday.locks_at !== null &&
        Date.parse(matchday.locks_at) > now,
    ) ??
    [...ordered]
      .reverse()
      .find((matchday) => matchday.status === "completed") ??
    null
  );
}

export const resolveDashboardMatchday = resolveRelevantMatchday;

export function resolveNextEditableDashboardMatchday(
  matchdays: StandingsMatchday[],
  primaryMatchday: StandingsMatchday | null,
  now: number,
) {
  if (!primaryMatchday) return null;
  return [...matchdays]
    .sort((a, b) => a.matchday_number - b.matchday_number)
    .find(
      (matchday) =>
        matchday.matchday_number > primaryMatchday.matchday_number &&
        ["upcoming", "open"].includes(matchday.status) &&
        matchday.locks_at !== null &&
        Date.parse(matchday.locks_at) > now,
    ) ?? null;
}

export function playerMatchdayLifecycle(
  matchday: Pick<StandingsMatchday, "status" | "locks_at">,
  now: number,
) {
  if (matchday.status === "completed") return "Completed";
  if (
    ["locked", "scoring"].includes(matchday.status) ||
    (matchday.locks_at !== null && Date.parse(matchday.locks_at) <= now)
  ) return "In progress";
  return "Open";
}

export function resolveCurrentCompetition(competitions: StandingsCompetition[], currentMatchday: StandingsMatchday | null) {
  const ordered = [...competitions].sort((a, b) => a.start_matchday - b.start_matchday);
  return ordered.find((competition) => competition.status === "active") ?? (currentMatchday ? ordered.find((competition) => competition.start_matchday <= currentMatchday.matchday_number && competition.end_matchday >= currentMatchday.matchday_number) : null) ?? ordered.find((competition) => competition.status === "upcoming") ?? null;
}

export function buildStandings(profiles: StandingsProfile[], entries: StandingsEntry[], matchdayById: Map<string, StandingsMatchday>, range?: { start: number; end: number }) {
  const rows = profiles.map((profile) => {
    const scored = entries.filter((entry) => {
      const number = matchdayById.get(entry.matchday_id)?.matchday_number;
      return entry.user_id === profile.id && entry.submitted_at !== null && entry.calculated_score !== null && number !== undefined && (!range || (number >= range.start && number <= range.end));
    }).sort((a, b) => (matchdayById.get(b.matchday_id)?.matchday_number ?? 0) - (matchdayById.get(a.matchday_id)?.matchday_number ?? 0));
    const points = scored.reduce((total, entry) => total + (entry.calculated_score ?? 0), 0);
    return { profile, points, played: scored.length, latest: scored[0]?.calculated_score ?? null, average: scored.length ? points / scored.length : 0, rank: 0 };
  });
  rows.sort((a, b) => b.points - a.points || playerDisplayName(a.profile).localeCompare(playerDisplayName(b.profile)));
  rows.forEach((row, index) => { row.rank = index > 0 && rows[index - 1].points === row.points ? rows[index - 1].rank : index + 1; });
  return rows;
}

export function currentCompetitionStandings(
  rows: ReturnType<typeof buildStandings>,
) {
  return rerankStandings(rows.filter(
    (row) =>
      (
        row.profile.is_active !== false &&
        row.profile.pick8_participation_active !== false
      ) || row.played > 0,
  ));
}

export function rerankStandings(rows: ReturnType<typeof buildStandings>) {
  const reranked = rows.map((row) => ({ ...row }));
  reranked.forEach((row, index) => {
    row.rank = index > 0 && reranked[index - 1].points === row.points
      ? reranked[index - 1].rank
      : index + 1;
  });
  return reranked;
}

export function overallSeasonStandings(
  rows: ReturnType<typeof buildStandings>,
) {
  return rerankStandings(rows.filter(
    (row) =>
      (
        row.profile.is_active !== false &&
        row.profile.pick8_participation_active !== false
      ) || row.played > 0,
  ));
}

export type CompetitionOption = { competition: StandingsCompetition; isCurrent: boolean };

/**
 * Competitions a player can browse on Tables, newest first. Future (not yet
 * started) competitions are excluded because they cannot have standings.
 * Identity is the competition id; the current one is whichever
 * `resolveCurrentCompetition` returns, never a hardcoded number.
 */
export function competitionSelectionOptions(
  competitions: StandingsCompetition[],
  current: StandingsCompetition | null,
): CompetitionOption[] {
  return [...competitions]
    .filter((competition) =>
      competition.id === current?.id ||
      (current
        ? competition.start_matchday < current.start_matchday
        : competition.status === "completed"),
    )
    .sort((a, b) => b.start_matchday - a.start_matchday)
    .map((competition) => ({ competition, isCurrent: competition.id === current?.id }));
}

/**
 * Resolves the `competition` query parameter against the offered options.
 * Unknown, repeated or future ids fall back to the current competition and
 * report `invalidRequest` so the page can say so instead of silently
 * showing different standings.
 */
export function resolveSelectedCompetition(
  options: CompetitionOption[],
  requested: string | string[] | undefined,
): { selected: CompetitionOption | null; invalidRequest: boolean } {
  const requestedId = Array.isArray(requested) ? requested[0] : requested;
  const fallback = options.find((option) => option.isCurrent) ?? options[0] ?? null;
  if (!requestedId) return { selected: fallback, invalidRequest: false };
  const match = options.find((option) => option.competition.id === requestedId);
  return match ? { selected: match, invalidRequest: false } : { selected: fallback, invalidRequest: true };
}

/** Matchdays inside one competition's fixed range; the only data its standings may read. */
export function competitionMatchdays(matchdays: StandingsMatchday[], competition: Pick<StandingsCompetition, "start_matchday" | "end_matchday">) {
  return matchdays.filter((matchday) => matchday.matchday_number >= competition.start_matchday && matchday.matchday_number <= competition.end_matchday);
}

/** Standings for exactly one competition: entries from other competitions' matchdays are dropped before scoring. */
export function buildCompetitionStandings(
  profiles: StandingsProfile[],
  entries: StandingsEntry[],
  matchdays: StandingsMatchday[],
  competition: Pick<StandingsCompetition, "start_matchday" | "end_matchday">,
) {
  const scoped = competitionMatchdays(matchdays, competition);
  const matchdayById = new Map(scoped.map((matchday) => [matchday.id, matchday]));
  const scopedEntries = entries.filter((entry) => matchdayById.has(entry.matchday_id));
  return currentCompetitionStandings(
    buildStandings(profiles, scopedEntries, matchdayById, { start: competition.start_matchday, end: competition.end_matchday }),
  );
}

/** Query string for selecting a competition: the current one is the parameter-less default; other params (e.g. `view`) are kept. */
export function competitionSelectionQuery(existing: string, competitionId: string, currentId: string | null) {
  const next = new URLSearchParams(existing);
  if (competitionId === currentId) next.delete("competition");
  else next.set("competition", competitionId);
  return next.toString();
}

/** A competition is final only when every matchday in its range exists and is completed; the stored `status` can lag behind. */
export function isCompetitionFinal(competition: Pick<StandingsCompetition, "start_matchday" | "end_matchday">, matchdays: StandingsMatchday[]) {
  const scoped = competitionMatchdays(matchdays, competition);
  return scoped.length === competition.end_matchday - competition.start_matchday + 1 && scoped.every((matchday) => matchday.status === "completed");
}
