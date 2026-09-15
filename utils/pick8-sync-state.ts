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
    !input.syncPending && !input.lifecycleChanged;
}

export function competitionRefreshRequired(input: {
  competition_refresh_pending: boolean;
  competition_refresh_after: string | null;
}, now = Date.now()) {
  return input.competition_refresh_pending ||
    (input.competition_refresh_after !== null && Date.parse(input.competition_refresh_after) <= now);
}

export type ProviderCadenceState = {
  status: string;
  firstKickoffAt: string | null;
  lastKickoffAt: string | null;
  hasLiveFixture: boolean;
  allTerminal: boolean;
  terminalConfirmed: boolean;
};

/** Durable provider cadence derived from lifecycle, never a historical cutoff. */
export function nextProviderCheckAt(input: ProviderCadenceState, now = Date.now()) {
  const firstKickoff = input.firstKickoffAt ? Date.parse(input.firstKickoffAt) : Number.NaN;
  const lastKickoff = input.lastKickoffAt ? Date.parse(input.lastKickoffAt) : Number.NaN;
  let delayMs: number;
  if (input.hasLiveFixture || input.status === "scoring") {
    delayMs = 5 * 60_000;
  } else if (input.allTerminal && input.terminalConfirmed) {
    delayMs = 24 * 60 * 60_000;
  } else if (input.allTerminal || input.status === "completed") {
    delayMs = 15 * 60_000;
  } else if (Number.isFinite(firstKickoff) && firstKickoff <= now + 30 * 60_000 &&
      (!Number.isFinite(lastKickoff) || lastKickoff >= now - 4 * 60 * 60_000)) {
    delayMs = 5 * 60_000;
  } else if (Number.isFinite(firstKickoff) && firstKickoff <= now + 24 * 60 * 60_000) {
    delayMs = 60 * 60_000;
  } else {
    delayMs = 6 * 60 * 60_000;
  }
  return new Date(now + delayMs).toISOString();
}
