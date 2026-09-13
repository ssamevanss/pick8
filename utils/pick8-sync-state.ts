import { createHash } from "node:crypto";

export type FingerprintFixture = {
  externalFixtureId: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamCrestUrl: string | null;
  awayTeamCrestUrl: string | null;
  kickoffAt: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
};

// Explicit fields prevent response metadata (including sync timestamps) from
// invalidating content. Version the format when its meaning changes.
export function matchdayContentFingerprint(season: number, matchday: number, fixtures: FingerprintFixture[]) {
  const rows = fixtures.map((f) => [
    f.externalFixtureId, f.homeTeamId, f.awayTeamId,
    f.homeTeamName, f.awayTeamName, f.homeTeamCrestUrl, f.awayTeamCrestUrl,
    new Date(f.kickoffAt).toISOString(), f.status, f.homeScore, f.awayScore,
  ]).sort((a, b) => String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0);
  return `v1:${createHash("sha256").update(JSON.stringify([season, matchday, rows])).digest("hex")}`;
}

export function canSkipMatchdayApplication(input: {
  appliedFingerprint: string | null;
  fetchedFingerprint: string;
  syncPending: boolean;
  scoringPending: boolean;
  lifecycleChanged: boolean;
}) {
  return input.appliedFingerprint === input.fetchedFingerprint &&
    !input.syncPending && !input.scoringPending && !input.lifecycleChanged;
}

export function competitionRefreshRequired(input: {
  competition_refresh_pending: boolean;
  competition_refresh_after: string | null;
}, now = Date.now()) {
  return input.competition_refresh_pending ||
    (input.competition_refresh_after !== null && Date.parse(input.competition_refresh_after) <= now);
}
