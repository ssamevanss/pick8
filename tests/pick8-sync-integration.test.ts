import test from "node:test";
import assert from "node:assert/strict";
import { harness, type Call } from "./helpers/pick8-sync-harness.ts";

test("10 fixtures / 10 entries: nothing due exits after one database request", async () => {
  const h = harness();
  await h.cron();
  h.calls.length = 0;
  const result = await h.cron();
  assert.equal(result.successes.length, 0);
  assert.equal(result.competitionRefresh, null);
  assert.equal(h.upstreamCalls(), 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].table, "discovery_rpc");
  assert.equal(h.tables.fixtures[0].last_synced_at, "old-check");
  for (const stage of ["discovery", "who_you_got", "fixture_application", "scoring", "competition_refresh", "total"]) {
    assert.ok(h.logs.some((log) => log.stage === stage));
  }
});

test("one due unchanged matchday uses two Pick 8 requests and one provider request", async () => {
  const h = harness(); await h.sync();
  h.tables.matchdays[0].next_provider_check_at = "2026-09-13T11:59:00.000Z";
  const providerBefore = h.upstreamCalls(); h.calls.length = 0;
  const result = await h.cron();
  assert.equal(result.successes[0].sync.fastPath, true);
  assert.equal(h.upstreamCalls() - providerBefore, 1);
  assert.equal(h.calls.length, 2);
});

test("WhoYouGot ETag acknowledgements avoid fixture reads and confirm terminal cadence", async () => {
  const h = harness(); h.etag('"terminal-v1"'); await h.sync();
  h.tables.matchdays[0].next_provider_check_at = "2026-09-13T11:59:00.000Z";
  h.calls.length = 0;
  const result = await h.cron();
  assert.equal(result.successes[0].sync.providerNotModified, true);
  assert.equal(result.successes[0].sync.nextProviderCheckAt, "2026-09-14T12:00:00.000Z");
  assert.equal(h.calls.filter((call) => call.table === "fixtures").length, 0);
  assert.equal(h.calls.length, 2);
});

test("local scoring-only recovery uses three Pick 8 requests and no provider request", async () => {
  const h = harness(); await h.sync(); h.localDirty();
  const providerBefore = h.upstreamCalls(); h.calls.length = 0;
  const result = await h.cron();
  assert.equal(result.metrics.localRecoveryOnlyCount, 1);
  assert.equal(h.upstreamCalls(), providerBefore);
  assert.equal(h.calls.length, 3);
});

test("Who You Got finished-score sync calculates a BTTS pick and updates entry scoring", async () => {
  const h = harness();
  const selection = h.tables.entry_selections[0];
  selection.category = "btts";
  selection.selected_team_side = null;
  h.tables.fixtures[0].home_score = 0;
  h.tables.fixtures[0].away_score = 0;
  h.upstream().fixtures[0].home_score = 1;
  h.upstream().fixtures[0].away_score = 1;

  await h.sync();

  assert.equal(selection.points_awarded, 10);
  assert.equal(selection.is_correct, true);
  assert.equal(h.tables.entries[0].calculated_score, 46);
});

test("future matchday not due uses bounded discovery only", async () => {
  const h = harness();
  h.tables.matchdays[0].status = "upcoming";
  h.tables.matchdays[0].locks_at = "2026-09-20T10:00:00.000Z";
  for (const fixture of h.tables.fixtures) fixture.kickoff_at = "2026-09-20T10:00:00.000Z";
  h.calls.length = 0;
  const result = await h.cron();
  assert.equal(result.skipped, true);
  assert.equal(h.upstreamCalls(), 0);
  assert.equal(h.calls.length, 1);
});

test("failed scoring preserves local recovery without undoing provider application", async () => {
  const h = harness();
  h.fail((call) => call.table === "rpc");
  await assert.rejects(h.sync(), /injected failure/);
  assert.ok(h.tables.matchdays[0].applied_fixture_fingerprint);
  assert.equal(h.tables.matchdays[0].fixture_application_pending, false);
  assert.equal(h.tables.matchdays[0].scoring_pending, true);
  const calls = h.upstreamCalls(); h.fail();
  await h.cron();
  assert.equal(h.upstreamCalls(), calls);
  assert.equal(h.tables.matchdays[0].scoring_pending, false);
});

test("a failed changed-fixture write keeps the old applied fingerprint and recovery pending", async () => {
  const h = harness(); await h.sync();
  const old = h.tables.matchdays[0].applied_fixture_fingerprint;
  h.upstream().fixtures[0].home_score = 3;
  h.fail((call) => call.table === "fixtures" && call.operation === "upsert");
  await assert.rejects(h.sync(), /injected failure/);
  assert.equal(h.tables.matchdays[0].applied_fixture_fingerprint, old);
  assert.equal(h.tables.matchdays[0].sync_pending, true);
  h.fail(); await h.sync();
  assert.notEqual(h.tables.matchdays[0].applied_fixture_fingerprint, old);
});

test("changed provider fixtures use one bulk upsert request", async () => {
  const h = harness(); await h.sync();
  h.tables.matchdays[0].next_provider_check_at = "2026-09-13T11:59:00.000Z";
  h.upstream().fixtures[0].home_score = 3; h.calls.length = 0;
  const result = await h.cron();
  assert.equal(result.totals.updated, 1);
  assert.equal(h.calls.filter((call) => call.table === "fixtures" && call.operation === "upsert").length, 1);
});

test("local dirty state and fixture-only calls cannot acknowledge pending scoring", async () => {
  const h = harness(); h.upstream().fixtures[0].home_score = 3; await h.fixtureOnly();
  assert.ok(h.tables.matchdays[0].applied_fixture_fingerprint);
  assert.equal(h.tables.matchdays[0].fixture_application_pending, false);
  assert.equal(h.tables.matchdays[0].scoring_pending, true);
  const calls = h.upstreamCalls(); await h.cron();
  assert.equal(h.upstreamCalls(), calls);
  assert.equal(h.tables.matchdays[0].scoring_pending, false);
});

test("concurrent input edits cannot be cleared by scoring acknowledgement", async () => {
  const h = harness();
  h.before((call) => {
    if (call.table === "rpc") { h.localDirty(); h.before(); }
  });
  await assert.rejects(h.sync(), /inputs changed/);
  assert.equal(h.tables.matchdays[0].scoring_pending, true);
  assert.ok(h.tables.matchdays[0].applied_fixture_fingerprint);
  assert.equal(h.tables.matchdays[0].fixture_application_pending, false);
});

test("concurrent local edits during the unchanged check cannot be acknowledged", async () => {
  const h = harness(); await h.sync();
  h.before((call) => {
    if (call.table === "matchdays" && call.values?.last_upstream_check_at && !call.values?.sync_pending) { h.dirty(); h.before(); }
  });
  await assert.rejects(h.sync(), /Local state changed/);
  assert.equal(h.tables.matchdays[0].sync_pending, true);
});

test("clock-only kickoff transition prevents a fingerprint fast exit", async () => {
  const h = harness();
  h.tables.matchdays[0].status = "open";
  for (const fixture of h.tables.fixtures) { fixture.status = "timed"; fixture.home_score = null; fixture.away_score = null; }
  h.resetUpstream(); h.clock("2026-09-13T09:00:00Z");
  await h.sync();
  assert.equal(h.tables.matchdays[0].status, "open");
  assert.equal((await h.sync()).fastPath, true);
  h.clock("2026-09-13T10:00:00Z");
  assert.equal((await h.sync()).fastPath, false);
  assert.equal(h.tables.matchdays[0].status, "scoring");
});

test("competition refresh failure retries independently of an unchanged provider matchday", async () => {
  const h = harness(); await h.sync();
  h.tables.seasons[0].competition_refresh_pending = true;
  h.fail((call) => call.table === "competitions");
  await assert.rejects(h.cron(), /injected failure/);
  assert.equal(h.tables.seasons[0].competition_refresh_pending, true);
  h.fail();
  const result = await h.cron();
  assert.equal(result.successes.length, 0);
  assert.equal(h.tables.seasons[0].competition_refresh_pending, false);
});

test("daily reconciliation also uses the clean fingerprint fast path", async () => {
  const h = harness(); await h.sync(); h.clock("2026-09-14T05:30:00Z"); h.calls.length = 0;
  const result = await h.reconcile();
  assert.equal(result.successes[0].sync.fastPath, true);
  assert.equal(result.successes[0].recalculated, false);
  assert.equal(h.calls.length, 2);
});

test("a revision change during fingerprint acknowledgement retains dirty state", async () => {
  const h = harness();
  h.before((call) => {
    if (call.values?.applied_fixture_fingerprint) { h.dirty(); h.before(); }
  });
  await assert.rejects(h.sync(), /retry required/);
  assert.equal(h.tables.matchdays[0].applied_fixture_fingerprint, null);
  assert.equal(h.tables.matchdays[0].sync_pending, true);
});

test("fixture membership removal still invalidates affected submissions before acknowledging", async () => {
  const h = harness(); await h.sync();
  h.upstream().fixtures.splice(0, 1);
  const result = await h.sync();
  assert.equal(result.fastPath, false);
  assert.equal(result.removed, 1);
  assert.equal(result.invalidatedEntries, 10);
  assert.equal(h.tables.entries.every((entry) => entry.submitted_at === null), true);
  assert.equal((await h.sync()).fastPath, true);
});

test("invalid provider data cannot refresh a clean fingerprint or check timestamp", async () => {
  const h = harness(); await h.sync();
  const before = { ...h.tables.matchdays[0] };
  h.upstream().fixtures.push(h.upstream().fixtures[0]);
  await assert.rejects(h.sync(), /duplicate fixture IDs/);
  assert.equal(h.tables.matchdays[0].applied_fixture_fingerprint, before.applied_fixture_fingerprint);
  assert.equal(h.tables.matchdays[0].last_upstream_check_at, before.last_upstream_check_at);
});

test("competition clock work runs even when the selected provider matchday is unchanged", async () => {
  const h = harness(); await h.sync();
  h.tables.matchdays.push({ ...h.tables.matchdays[0], id: "next", matchday_number: 6, status: "upcoming", locks_at: "2026-09-13T13:00:00.000Z" });
  h.tables.seasons[0].competition_refresh_pending = true;
  await h.cron();
  assert.equal(h.tables.seasons[0].competition_refresh_after, "2026-09-13T13:00:00.000Z");
  h.clock("2026-09-13T13:00:00Z");
  const result = await h.cron();
  assert.equal(result.successes[0].sync.fastPath, true);
  assert.equal(result.competitionRefresh?.statusesUpdated, 2);
  assert.equal(h.tables.seasons[0].competition_refresh_after, null);
});

const competitionAck = (call: Call) => call.table === "seasons" && call.values?.competition_refresh_pending === false;

test("ambiguous competition acknowledgement reads back committed checkpoint without re-dirtying", async () => {
  const h = harness(); await h.sync(); h.tables.seasons[0].competition_refresh_pending = true;
  h.ambiguous(competitionAck);
  const result = await h.cron();
  assert.equal(result.ok, true);
  assert.equal(h.tables.seasons[0].competition_refresh_pending, false);
  assert.equal(h.calls.filter(competitionAck).length, 1);
  h.calls.length = 0;
  await h.cron();
  assert.equal(h.calls.length, 1);
});

test("ambiguous acknowledgement preserves a newer revision and its pending work", async () => {
  const h = harness(); await h.sync(); h.tables.seasons[0].competition_refresh_pending = true;
  h.ambiguous((call) => {
    if (!competitionAck(call)) return false;
    h.tables.seasons[0].competition_revision = Number(h.tables.seasons[0].competition_revision) + 1;
    h.tables.seasons[0].competition_refresh_pending = true;
    return true;
  });
  await assert.rejects(h.cron(), /Acknowledging competition refresh failed/);
  assert.equal(h.tables.seasons[0].competition_refresh_pending, true);
  assert.equal(h.calls.filter(competitionAck).length, 1);
  h.ambiguous(); await h.cron();
  assert.equal(h.tables.seasons[0].competition_refresh_pending, false);
});

test("failed readback does not overwrite an overlapping worker's completion", async () => {
  const h = harness(); await h.sync(); h.tables.seasons[0].competition_refresh_pending = true;
  h.ambiguous((call) => {
    if (!competitionAck(call)) return false;
    h.tables.seasons[0].competition_revision = Number(h.tables.seasons[0].competition_revision) + 1;
    h.tables.seasons[0].competition_refresh_pending = false;
    h.fail((read) => read.table === "seasons" && read.operation === "select");
    return true;
  });
  await assert.rejects(h.cron(), /Acknowledging competition refresh failed/);
  assert.equal(h.tables.seasons[0].competition_refresh_pending, false);
  assert.equal(h.calls.at(-1)?.operation, "select");
});

test("failed competition load cannot re-dirty another worker's successful refresh", async () => {
  const h = harness(); await h.sync(); h.tables.seasons[0].competition_refresh_pending = true;
  h.fail((call) => {
    if (call.table !== "competitions") return false;
    h.tables.seasons[0].competition_refresh_pending = false;
    return true;
  });
  await assert.rejects(h.cron(), /Loading competitions failed/);
  assert.equal(h.tables.seasons[0].competition_refresh_pending, false);
});

test("committed scoring and fingerprint acknowledgements survive lost responses", async () => {
  const h = harness();
  h.ambiguous((call) => call.table === "rpc" || (call.table === "matchdays" &&
    typeof call.values?.applied_fixture_fingerprint === "string"));
  const result = await h.cron();
  assert.equal(result.ok, true);
  assert.equal(h.tables.matchdays[0].sync_pending, false);
  assert.equal(h.tables.matchdays[0].scoring_pending, false);
  h.calls.length = 0;
  await h.cron();
  assert.equal(h.calls.length, 1);
});

test("older competition refresh cannot overwrite a newer clock checkpoint at the same revision", async () => {
  const h = harness(); await h.sync(); h.tables.seasons[0].competition_refresh_pending = true;
  h.before((call) => {
    if (!competitionAck(call)) return;
    h.tables.seasons[0].competition_refresh_after = "2026-09-15T12:00:00.000Z";
    h.tables.seasons[0].competition_refresh_pending = false;
    h.before();
  });
  await assert.rejects(h.cron(), /Competition inputs changed/);
  assert.equal(h.tables.seasons[0].competition_refresh_after, "2026-09-15T12:00:00.000Z");
  assert.equal(h.tables.seasons[0].competition_refresh_pending, false);
});


test("failed provider-application acknowledgement retains recovery and retries safely", async () => {
  const h = harness();
  h.fail(call => typeof call.values?.applied_fixture_fingerprint === "string");
  await assert.rejects(h.sync(), /injected failure/);
  assert.equal(h.tables.matchdays[0].scoring_pending, false);
  assert.equal(h.tables.matchdays[0].sync_pending, true);
  const providerBefore = h.upstreamCalls(); h.fail(); h.calls.length = 0;
  const result = await h.cron();
  assert.equal(result.successes[0].sync.fastPath, true);
  assert.equal(h.upstreamCalls(), providerBefore);
  assert.equal(h.calls.filter(c=>c.table === "rpc").length, 0);
  assert.equal(h.tables.matchdays[0].sync_pending, false);
  assert.equal(h.tables.matchdays[0].status, "completed");
});

test("insufficient admission budget returns a durable deferred result without RPC or competition work", async () => {
  const h = harness();
  h.before(call => { if (call.table === "matchdays" && call.operation === "upsert") h.limitBudget(1000); });
  const result = await h.cron();
  assert.equal(result.ok, true);
  assert.equal("complete" in result && result.complete, false);
  assert.equal("deferred" in result && result.deferred.length, 1);
  assert.equal(h.tables.matchdays[0].scoring_pending, true);
  assert.equal(h.tables.matchdays[0].sync_pending, false);
  assert.equal(h.calls.filter(c=>c.table === "rpc" || c.table === "competitions").length, 0);
});

test("ambiguous scoring response reads committed result once without repeating RPC", async () => {
  const h = harness(); h.ambiguous(call => call.table === "rpc");
  const result = await h.cron();
  assert.equal(result.ok, true);
  assert.equal(h.calls.filter(c=>c.table === "rpc").length, 1);
  assert.ok(h.logs.some(l => l.readbackOutcome === "committed"));
  assert.equal(h.tables.matchdays[0].scoring_pending, false);
});

test("ambiguous response cannot acknowledge a newer input revision or re-dirty an overlapping completion", async () => {
  const h = harness();
  h.ambiguous(call => {
    if (call.table !== "rpc") return false;
    h.dirty(); return true;
  });
  const result = await h.cron();
  assert.equal("deferred" in result && result.deferred.length, 1);
  assert.equal(h.tables.matchdays[0].scoring_pending, true);
  assert.equal(h.calls.filter(c=>c.table === "rpc").length, 1);
});

test("failed ambiguous read-back returns deferred and preserves committed checkpoint", async () => {
  const h = harness();
  h.ambiguous(call => {
    if (call.table !== "rpc") return false;
    h.fail(read => read.table === "matchdays" && read.operation === "select"); return true;
  });
  const result = await h.cron();
  assert.equal("deferred" in result && result.deferred.length, 1);
  assert.equal(h.tables.matchdays[0].scoring_pending, false);
  assert.equal(h.calls.filter(c=>c.table === "rpc").length, 1);
  h.fail(); h.ambiguous(); h.calls.length = 0;
  await h.sync();
  assert.equal(h.calls.filter(c=>c.table === "rpc").length, 0);
});


test("fingerprint recovery never overwrites a concurrent writer's scoring pending flag", async () => {
  const h = harness();
  h.fail(call => typeof call.values?.applied_fixture_fingerprint === "string");
  await assert.rejects(h.sync()); h.fail(); h.calls.length = 0;
  h.before(call => {
    if (call.table === "matchdays" && call.operation === "upsert") {
      assert.equal(Object.hasOwn(call.values!, "scoring_pending"), false);
      h.dirty(); h.before();
    }
  });
  const result = await h.sync();
  assert.equal(result.scoring?.reused, false);
  assert.equal(h.calls.filter(c=>c.table === "rpc").length, 1);
  assert.equal(h.tables.matchdays[0].scored_revision, h.tables.matchdays[0].scoring_revision);
});

for (const code of ["55P03", "40P01", "40001", "57014"]) {
  test(`RPC ${code} rollback is deferred durably without retrying the mutation`, async () => {
    const h = harness(); h.rpcError(code);
    const result = await h.cron();
    assert.equal("deferred" in result && result.deferred.length, 1);
    assert.equal(h.calls.filter(c=>c.table === "rpc").length, 1);
    assert.equal(h.tables.matchdays[0].scoring_pending, true);
    assert.equal(h.tables.matchdays[0].sync_pending, false);
  });
}
