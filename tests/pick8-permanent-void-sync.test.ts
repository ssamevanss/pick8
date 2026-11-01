import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers/pick8-sync-harness.ts";

// The real sync, scoring wrapper and cron discovery against a REST-shaped store whose fixture writes obey the same void
// and deadline rules as the database triggers (their SQL is proven in tests/pick8-permanent-void-postgres.mjs).
// Matchday 5 is locked since 10:00; "now" is 12:00 and fixture-0 is still to be played at 15:00.
const KICKOFF = "2026-09-13T15:00:00.000Z";
const NEXT_WEEK = "2026-09-20T15:00:00.000Z";

function pendingFirst() {
  return harness({ seed: (tables) => {
    Object.assign(tables.fixtures[0], { status: "timed", home_score: null, away_score: null, kickoff_at: KICKOFF });
    tables.matchdays[0].status = "scoring";
  } });
}
const first = (h: ReturnType<typeof harness>) => h.tables.fixtures[0];
const upstreamFirst = (h: ReturnType<typeof harness>) => h.upstream().fixtures[0] as Record<string, unknown>;
const scores = (h: ReturnType<typeof harness>) => h.tables.entries.map((entry) => entry.calculated_score);

test("a postponed fixture completes the matchday on the rest; a later date and a later score change nothing", async () => {
  const h = pendingFirst();
  await h.sync();
  assert.equal(h.tables.matchdays[0].status, "scoring");
  assert.ok(scores(h).every((score) => score === null));

  Object.assign(upstreamFirst(h), { status: "postponed" });
  const postponed = await h.sync();
  assert.equal(first(h).void_reason, "postponed");
  assert.equal(postponed.matchdayStatus, "completed");
  const final = scores(h);
  assert.ok(final.every((score) => score !== null));
  const voidedAt = first(h).voided_at;

  Object.assign(upstreamFirst(h), { status: "timed", kickoff_at: NEXT_WEEK });
  const rescheduled = await h.sync();
  assert.equal(rescheduled.matchdayStatus, "completed");
  assert.equal(h.tables.matchdays[0].status, "completed");
  assert.deepEqual(scores(h), final);
  assert.equal(first(h).kickoff_at, NEXT_WEEK, "the new date is still mirrored for display");
  assert.equal(first(h).voided_at, voidedAt);

  Object.assign(upstreamFirst(h), { status: "finished", home_score: 3, away_score: 3 });
  h.clock("2026-09-20T18:00:00Z");
  await h.sync();
  assert.equal(h.tables.matchdays[0].status, "completed");
  assert.deepEqual(scores(h), final);
  assert.equal(first(h).voided_at, voidedAt);
  assert.ok(h.tables.entry_selections.filter((s) => s.fixture_id === "fixture-0").every((s) => s.points_awarded === null));
});

test("repeated syncs of a voided, rescheduled fixture are no-ops: no writes, no scoring, 24 hour cadence", async () => {
  const h = pendingFirst();
  await h.sync();
  Object.assign(upstreamFirst(h), { status: "postponed" });
  await h.sync();
  Object.assign(upstreamFirst(h), { status: "timed", kickoff_at: NEXT_WEEK });
  await h.sync();
  const settled = JSON.stringify({ fixtures: h.tables.fixtures, matchday: { ...h.tables.matchdays[0], last_upstream_check_at: null, next_provider_check_at: null, terminal_confirmed_at: null } });

  h.calls.length = 0;
  const repeat = await h.sync();
  assert.equal(repeat.fastPath, true);
  assert.equal(repeat.matchdayStatus, "completed");
  assert.equal(h.calls.filter((call) => call.operation === "rpc").length, 0, "no scoring run");
  assert.equal(h.calls.filter((call) => call.table === "fixtures" && call.operation !== "select").length, 0, "no fixture write");
  assert.equal(repeat.nextProviderCheckAt, "2026-09-14T12:00:00.000Z", "a completed matchday with a void fixture is re-read daily, not every five minutes");
  assert.equal(JSON.stringify({ fixtures: h.tables.fixtures, matchday: { ...h.tables.matchdays[0], last_upstream_check_at: null, next_provider_check_at: null, terminal_confirmed_at: null } }), settled);

  // Cron discovery names the voided fixture, so a due poll costs two database requests and no fixture read.
  h.tables.matchdays[0].next_provider_check_at = "2026-09-13T11:59:00.000Z";
  h.tables.seasons[0].competition_refresh_pending = false; // the store stand-in flags it on any lifecycle write; the database does not
  h.calls.length = 0;
  const providerBefore = h.upstreamCalls();
  const result = await h.cron() as unknown as { successes: Array<{ sync: { fastPath?: boolean } }> };
  assert.equal(result.successes[0].sync.fastPath, true);
  assert.equal(h.upstreamCalls() - providerBefore, 1);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls.filter((call) => call.table === "fixtures").length, 0);
});

test("rescheduling the earliest fixture after the lock neither moves the deadline nor breaks the sync", async () => {
  const h = harness({ seed: (tables) => {
    Object.assign(tables.fixtures[0], { status: "timed", home_score: null, away_score: null, kickoff_at: "2026-09-13T10:00:00.000Z" });
    tables.fixtures.slice(1).forEach((fixture) => { fixture.kickoff_at = "2026-09-13T10:30:00.000Z"; });
    tables.matchdays[0].status = "scoring";
  } });
  await h.sync();
  const deadline = h.tables.matchdays[0].locks_at;
  assert.equal(deadline, "2026-09-13T10:00:00.000Z");

  Object.assign(upstreamFirst(h), { kickoff_at: "2026-09-14T15:00:00.000Z" });
  const moved = await h.sync();
  assert.equal(h.tables.matchdays[0].locks_at, deadline, "the stored deadline can only move earlier");
  assert.equal(first(h).void_reason, "rescheduled");
  assert.equal(moved.matchdayStatus, "completed");
  // Without the protected deadline the recomputed one (10:30) disagrees with the stored one and verification fails.
  await h.sync();
  assert.equal((await h.sync()).fastPath, true, "the deadline the sync computes agrees with the one the database keeps");
});

test("a delayed kickoff on the same day is the same match and is not voided", async () => {
  const h = pendingFirst();
  await h.sync();
  Object.assign(upstreamFirst(h), { kickoff_at: "2026-09-13T15:45:00.000Z" });
  await h.sync();
  assert.equal(first(h).kickoff_at, "2026-09-13T15:45:00.000Z");
  assert.equal(first(h).voided_at ?? null, null);
  assert.equal(h.tables.matchdays[0].status, "scoring");
});

test("suspended is held and scored if it resumes; abandoned is voided only when it is replayed on a later day", async () => {
  const h = pendingFirst();
  await h.sync();

  Object.assign(upstreamFirst(h), { status: "cancelled", providerStatus: "SUSPENDED", home_score: 1, away_score: 0, kickoff_at: "2026-09-13T11:00:00.000Z" });
  await h.sync();
  assert.equal(first(h).status, "suspended");
  assert.equal(h.tables.matchdays[0].status, "scoring", "a suspended match does not let the matchday complete");
  Object.assign(upstreamFirst(h), { status: "finished", providerStatus: "FINISHED", home_score: 2, away_score: 1 });
  await h.sync();
  assert.equal(first(h).voided_at ?? null, null);
  assert.equal(h.tables.matchdays[0].status, "completed");
  assert.ok(scores(h).every((score) => score !== null));

  const replay = pendingFirst();
  await replay.sync();
  Object.assign(upstreamFirst(replay), { status: "cancelled", providerStatus: "ABANDONED", kickoff_at: "2026-09-13T11:00:00.000Z" });
  await replay.sync();
  assert.equal(first(replay).status, "abandoned");
  assert.equal(replay.tables.matchdays[0].status, "scoring");
  Object.assign(upstreamFirst(replay), { status: "timed", providerStatus: "TIMED", kickoff_at: NEXT_WEEK });
  const replayed = await replay.sync();
  assert.equal(first(replay).void_reason, "abandoned");
  assert.equal(replayed.matchdayStatus, "completed");
});

test("genuine corrections to a finished, non-voided fixture still recalculate a completed matchday that has a void fixture", async () => {
  const h = pendingFirst();
  await h.sync();
  Object.assign(upstreamFirst(h), { status: "postponed" });
  await h.sync();
  const before = scores(h);
  const second = h.upstream().fixtures[1] as Record<string, unknown>;
  Object.assign(second, { home_score: 0, away_score: 3 });
  const corrected = await h.sync();
  assert.equal(corrected.matchdayStatus, "completed");
  assert.notDeepEqual(scores(h), before, "fixture-1's correction changes the entries that picked it");
  assert.equal(first(h).voided_at !== null, true);
});

test("a malformed providerStatus fails the matchday closed", async () => {
  const h = pendingFirst();
  await h.sync();
  const before = JSON.stringify(h.tables.fixtures);
  Object.assign(upstreamFirst(h), { status: "cancelled", providerStatus: ["SUSPENDED"] });
  await assert.rejects(h.sync(), (error: { code?: string }) => error.code === "invalid_response");
  assert.equal(JSON.stringify(h.tables.fixtures), before);
});

test("pre-deadline: a fixture moved to another day before the entry deadline is void for good; the deadline and other fixtures are untouched", async () => {
  const h = harness({ seed: (tables) => {
    tables.fixtures.forEach((fixture) => Object.assign(fixture, { status: "timed", home_score: null, away_score: null, kickoff_at: KICKOFF }));
    Object.assign(tables.matchdays[0], { status: "open", locks_at: KICKOFF });
  } });
  await h.sync();
  assert.equal(h.tables.matchdays[0].locks_at, KICKOFF);

  const upstreamAt = (index: number) => h.upstream().fixtures[index] as Record<string, unknown>;
  Object.assign(upstreamAt(1), { kickoff_at: "2026-09-13T16:30:00.000Z" });
  await h.sync();
  assert.equal(h.tables.fixtures[1].voided_at ?? null, null, "a delay within the same day is the same match");

  Object.assign(upstreamAt(0), { kickoff_at: NEXT_WEEK });
  await h.sync();
  assert.equal(first(h).void_reason, "rescheduled", "the entry deadline (15:00) has not passed, and the move is still decided");
  assert.equal(h.tables.matchdays[0].locks_at, KICKOFF, "the other fixtures still set the deadline");
  assert.notEqual(h.tables.matchdays[0].status, "completed");
  const voidedAt = first(h).voided_at;

  Object.assign(upstreamAt(0), { kickoff_at: KICKOFF });
  await h.sync();
  Object.assign(upstreamAt(0), { status: "finished", home_score: 4, away_score: 4 });
  await h.sync();
  assert.equal(first(h).voided_at, voidedAt, "moving back or being played changes nothing");
  assert.equal(h.tables.fixtures.filter((fixture) => fixture.voided_at != null).length, 1);

  await h.sync();
  assert.equal((await h.sync()).fastPath, true, "an identical sync is a no-op");
});

const settleCalls = (h: ReturnType<typeof harness>) => h.calls.filter((call) => call.table === "rpc" && call.values && "check_now" in call.values && !("check_scoring_revision" in call.values));

for (const [name, run, scoresInRun] of [
  ["sync-results", (h: ReturnType<typeof harness>) => h.cron(), true],
  ["reconcile-results", (h: ReturnType<typeof harness>) => h.reconcile(), true],
  ["sync-fixtures", (h: ReturnType<typeof harness>) => h.daily(), false],
] as const) {
  test(`${name} settles a suspended match after 14 days from local data, even though the provider stopped checking it`, async () => {
    const h = harness({ seed: (tables) => {
      Object.assign(tables.fixtures[0], { status: "suspended", home_score: 1, away_score: 0, kickoff_at: "2026-08-20T15:00:00.000Z" });
      // The provider cadence has parked this matchday far in the future: nothing would poll it.
      Object.assign(tables.matchdays[0], { status: "scoring", next_provider_check_at: "2026-12-01T00:00:00.000Z" });
    } });
    Object.assign(upstreamFirst(h), { status: "cancelled", providerStatus: "SUSPENDED" });
    await run(h);
    assert.equal(settleCalls(h).length, 1, "one settlement");
    assert.equal(first(h).void_reason, "expired");
    if (!scoresInRun) { assert.equal(h.tables.matchdays[0].scoring_pending, true, "flagged for scoring"); await h.cron(); } // the next results run scores it
    assert.equal(h.tables.matchdays[0].status, "completed", "the matchday completes on the remaining fixtures");
    assert.ok(scores(h).every((score) => score !== null));
    assert.ok(h.tables.entry_selections.filter((s) => s.fixture_id === "fixture-0").every((s) => s.points_awarded === null));

    const voidedAt = first(h).voided_at;
    const final = scores(h);
    h.calls.length = 0;
    await run(h);
    assert.equal(settleCalls(h).length, 0, "nothing left to settle: no extra request");
    assert.equal(first(h).voided_at, voidedAt);
    assert.deepEqual(scores(h), final);
  });
}

test("a suspended match that is still inside its 14 days is left held, and no settlement request is made", async () => {
  const h = harness({ seed: (tables) => {
    Object.assign(tables.fixtures[0], { status: "suspended", home_score: 1, away_score: 0, kickoff_at: "2026-09-01T15:00:00.000Z" });
    tables.matchdays[0].status = "scoring";
  } });
  Object.assign(upstreamFirst(h), { status: "cancelled", providerStatus: "SUSPENDED" });
  await h.reconcile();
  assert.equal(settleCalls(h).length, 0);
  assert.equal(first(h).voided_at ?? null, null);
  assert.equal(h.tables.matchdays[0].status, "scoring");

  h.clock("2026-09-15T15:00:00Z"); // 14 days after kickoff
  await h.reconcile();
  assert.equal(settleCalls(h).length, 1);
  assert.equal(first(h).void_reason, "expired");
});

test("a settled suspended match stays void if the provider resumes it afterwards", async () => {
  const h = harness({ seed: (tables) => {
    Object.assign(tables.fixtures[0], { status: "suspended", home_score: 1, away_score: 0, kickoff_at: "2026-08-20T15:00:00.000Z" });
    tables.matchdays[0].status = "scoring";
  } });
  Object.assign(upstreamFirst(h), { status: "cancelled", providerStatus: "SUSPENDED" });
  await h.reconcile();
  const final = scores(h);
  Object.assign(upstreamFirst(h), { status: "finished", providerStatus: "FINISHED", home_score: 6, away_score: 0 });
  h.clock("2026-09-14T12:00:00Z");
  await h.reconcile();
  assert.equal(first(h).void_reason, "expired");
  assert.equal(h.tables.matchdays[0].status, "completed");
  assert.deepEqual(scores(h), final);
});
