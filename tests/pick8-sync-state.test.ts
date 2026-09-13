import test from "node:test";
import assert from "node:assert/strict";
import { matchdayContentFingerprint, canSkipMatchdayApplication, competitionRefreshRequired, type FingerprintFixture } from "../utils/pick8-sync-state.ts";

const fixture: FingerprintFixture = {
  externalFixtureId: "123", homeTeamId: 1, awayTeamId: 2,
  homeTeamName: "Home", awayTeamName: "Away",
  homeTeamCrestUrl: "https://example.test/home.png", awayTeamCrestUrl: null,
  kickoffAt: "2026-09-13T12:00:00Z", status: "finished", homeScore: 2, awayScore: 1,
};
const fingerprint = (fixtures: FingerprintFixture[]) => matchdayContentFingerprint(2026, 5, fixtures);

test("canonical fingerprint ignores ordering, equivalent kickoff formatting and volatile metadata", () => {
  const other = { ...fixture, externalFixtureId: "456" };
  assert.equal(fingerprint([fixture, other]), fingerprint([other, {
    ...fixture, kickoffAt: "2026-09-13T13:00:00+01:00", last_synced_at: "later", request_id: "new",
  } as FingerprintFixture]));
});

test("fingerprint covers membership, provider scope and every consumed fixture field", () => {
  const original = fingerprint([fixture]);
  const changes: Partial<FingerprintFixture>[] = [
    { externalFixtureId: "different" }, { homeTeamId: 9 }, { awayTeamId: null },
    { homeTeamName: "Renamed" }, { awayTeamName: "Renamed" },
    { homeTeamCrestUrl: null }, { awayTeamCrestUrl: "https://example.test/new.png" },
    { kickoffAt: "2026-09-13T12:01:00Z" }, { status: "paused" },
    { homeScore: null }, { awayScore: 0 },
  ];
  for (const change of changes) assert.notEqual(original, fingerprint([{ ...fixture, ...change }]));
  assert.notEqual(original, fingerprint([]));
  assert.notEqual(original, fingerprint([fixture, { ...fixture, externalFixtureId: "456" }]));
  assert.notEqual(original, matchdayContentFingerprint(2027, 5, [fixture]));
  assert.notEqual(original, matchdayContentFingerprint(2026, 6, [fixture]));
});

test("same upstream content cannot hide dirty scoring, recovery, first sync or a clock transition", () => {
  const clean = { appliedFingerprint: "v1:hash", fetchedFingerprint: "v1:hash", syncPending: false, scoringPending: false, lifecycleChanged: false };
  assert.equal(canSkipMatchdayApplication(clean), true);
  for (const change of [
    { appliedFingerprint: null }, { fetchedFingerprint: "changed" },
    { syncPending: true }, { scoringPending: true }, { lifecycleChanged: true },
  ]) assert.equal(canSkipMatchdayApplication({ ...clean, ...change }), false);
});

test("competition work remains independently due after failures and clock boundaries", () => {
  const now = Date.parse("2026-09-13T12:00:00Z");
  assert.equal(competitionRefreshRequired({ competition_refresh_pending: false, competition_refresh_after: null }, now), false);
  assert.equal(competitionRefreshRequired({ competition_refresh_pending: true, competition_refresh_after: null }, now), true);
  assert.equal(competitionRefreshRequired({ competition_refresh_pending: false, competition_refresh_after: "2026-09-13T12:00:00Z" }, now), true);
  assert.equal(competitionRefreshRequired({ competition_refresh_pending: false, competition_refresh_after: "2026-09-13T12:01:00Z" }, now), false);
});
