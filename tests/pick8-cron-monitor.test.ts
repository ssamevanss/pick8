import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyCronResult,
  effectiveOutcome,
  evaluateCronHealth,
  evaluateCronJob,
  PICK8_CRON_SCHEDULES,
  resolveMonitoringBaseline,
  RUNNING_STALE_MS,
  type Pick8CronExecution,
  type Pick8CronJob,
  type Pick8CronOutcome,
} from "../utils/pick8-cron-monitor.ts";

const NOW = Date.parse("2026-11-03T10:00:00Z");
const MIN = 60_000;
const at = (iso: string) => Date.parse(iso);
const ago = (minutes: number, now = NOW) => new Date(now - minutes * MIN).toISOString();

function run(job: Pick8CronJob, startedAt: string, outcome: Pick8CronOutcome = "success", error: string | null = null): Pick8CronExecution {
  return {
    job, started_at: startedAt, outcome, error,
    finished_at: outcome === "running" ? null : startedAt, duration_ms: outcome === "running" ? null : 100, summary: {},
  };
}
/** Newest-first list of a job's runs at the given minute offsets (minutes before `now`). */
const runs = (job: Pick8CronJob, offsets: number[], outcome: Pick8CronOutcome = "success", now = NOW) =>
  offsets.map((minutes) => run(job, ago(minutes, now), outcome));

const evaluate = (
  job: Pick8CronJob, executions: Pick8CronExecution[],
  { baselineAt = "2026-10-01T00:00:00Z", now = NOW }: { baselineAt?: string | null; now?: number } = {},
) => evaluateCronJob({ job, executions, lastSuccessAt: executions.find((r) => r.outcome === "success")?.started_at ?? null, baselineAt, now });

// --- classification -------------------------------------------------------------------------------

test("a normal run is a success; nothing-due and no-active-season runs are legitimate no-ops", () => {
  assert.equal(classifyCronResult({ ok: true, complete: true, skipped: false, matchdaysAttempted: [5], failures: [], deferred: [] }).outcome, "success");
  assert.equal(classifyCronResult({ ok: true, skipped: true, reason: "No matchday currently needs a result check.", matchdaysAttempted: [] }).outcome, "no_op");
  assert.equal(classifyCronResult({ ok: true, skipped: true, reason: "No active season is configured." }).outcome, "no_op");
});

test("a business failure (HTTP 200 body with ok:false) is a failure and carries a bounded message", () => {
  const long = "x".repeat(1_000);
  const result = classifyCronResult({ ok: false, complete: false, matchdaysAttempted: [5, 6], failures: [{ matchday: 5, error: long }, { matchday: 6, error: "later" }], deferred: [] });
  assert.equal(result.outcome, "failure");
  assert.equal(result.error?.length, 300);
  assert.deepEqual(result.summary, { matchdays: 2, failures: 2, deferred: 0, complete: false });
  assert.equal(classifyCronResult({ ok: false, error: "Result automation failed." }).error, "Result automation failed.");
  assert.equal(classifyCronResult({ ok: false }).outcome, "failure");
});

test("deferred scoring alone is not a failure", () => {
  const result = classifyCronResult({ ok: true, complete: false, failures: [], deferred: [{ matchday: 5 }], matchdaysAttempted: [5] });
  assert.equal(result.outcome, "success");
  assert.equal(result.summary.deferred, 1);
});

// --- bootstrap and legitimate inactivity ----------------------------------------------------------

test("an empty history is healthy and never reports a missed run", () => {
  const health = evaluateCronHealth({
    executionsByJob: { "sync-results": [], "sync-fixtures": [], "reconcile-results": [] },
    lastSuccessByJob: { "sync-results": null, "sync-fixtures": null, "reconcile-results": null },
    monitoring: resolveMonitoringBaseline(undefined, null), now: NOW,
  });
  assert.equal(health.healthy, true);
  assert.equal(health.monitoring.source, "none");
  assert.deepEqual(health.jobs.map((job) => job.status), ["awaiting_first_run", "awaiting_first_run", "awaiting_first_run"]);
});

test("daily jobs are not expected before monitoring has existed for an hour ahead of their schedule", () => {
  // Monitoring first observed the system at 01:30 UTC (e.g. the first deploy); sync-fixtures is due 02:15.
  const baselineAt = "2026-11-03T01:30:00Z";
  const state = evaluate("sync-fixtures", [], { baselineAt, now: at("2026-11-03T04:16:00Z") });
  assert.equal(state.status, "awaiting_first_run");
  // The same absence once the baseline is comfortably older is a miss.
  assert.equal(evaluate("sync-fixtures", [], { baselineAt: "2026-11-02T20:00:00Z", now: at("2026-11-03T04:16:00Z") }).status, "missed");
});

test("sync-results with no row yet is measured from when monitoring began, not from epoch", () => {
  const baselineAt = ago(5);
  assert.equal(evaluate("sync-results", [], { baselineAt }).status, "healthy");
  assert.equal(evaluate("sync-results", [], { baselineAt: ago(20) }).status, "missed");
});

test("hours of no-op runs are healthy: inactivity is not an incident", () => {
  const noOps = Array.from({ length: 200 }, (_, i) => run("sync-results", ago(2 + i * 5), "no_op"));
  const state = evaluate("sync-results", noOps);
  assert.equal(state.status, "healthy");
  assert.equal(state.lastOutcome, "no_op");
});

// --- missed executions ----------------------------------------------------------------------------

test("sync-results is missed only after three beats of silence", () => {
  assert.equal(evaluate("sync-results", runs("sync-results", [14])).status, "healthy");
  assert.equal(evaluate("sync-results", runs("sync-results", [16])).status, "missed");
  assert.match(evaluate("sync-results", runs("sync-results", [16])).reason, /No run since/);
});

test("a failed attempt still proves the scheduler fired: failure is reported as failing, not missed", () => {
  const state = evaluate("sync-results", runs("sync-results", [2, 7, 12], "failure"));
  assert.equal(state.status, "failing");
});

test("daily job: not missed inside its grace window, missed after it, healthy once it runs", () => {
  const yesterday = [run("sync-fixtures", "2026-11-02T02:16:00Z")];
  assert.equal(evaluate("sync-fixtures", yesterday, { now: at("2026-11-03T03:00:00Z") }).status, "healthy");
  assert.equal(evaluate("sync-fixtures", yesterday, { now: at("2026-11-03T04:14:00Z") }).status, "healthy");
  const missed = evaluate("sync-fixtures", yesterday, { now: at("2026-11-03T04:16:00Z") });
  assert.equal(missed.status, "missed");
  assert.match(missed.reason, /2026-11-03T02:15:00.000Z/);
  const recovered = evaluate("sync-fixtures", [run("sync-fixtures", "2026-11-03T04:30:00Z"), ...yesterday], { now: at("2026-11-03T04:31:00Z") });
  assert.equal(recovered.status, "healthy");
});

test("a miss is still reported on the following day until a run happens", () => {
  const old = [run("reconcile-results", "2026-11-01T05:31:00Z")];
  // 2026-11-03 06:00: yesterday's 05:30 window (deadline 07:30 on 11-02) elapsed unfulfilled.
  assert.equal(evaluate("reconcile-results", old, { now: at("2026-11-03T06:00:00Z") }).status, "missed");
});

test("a Vercel run that starts slightly before its nominal time counts for that day", () => {
  const early = [run("sync-fixtures", "2026-11-03T02:00:30Z")];
  assert.equal(evaluate("sync-fixtures", early, { now: at("2026-11-03T05:00:00Z") }).status, "healthy");
});

// --- failures and recovery ------------------------------------------------------------------------

test("two failures in a row are tolerated for sync-results; three raise 'failing'; one success recovers", () => {
  assert.equal(evaluate("sync-results", [...runs("sync-results", [1, 6], "failure"), run("sync-results", ago(11))]).status, "healthy");
  const three = runs("sync-results", [1, 6, 11], "failure");
  assert.equal(evaluate("sync-results", three).status, "failing");
  assert.equal(evaluate("sync-results", [run("sync-results", ago(0.5)), ...three]).status, "healthy");
  assert.equal(evaluate("sync-results", [run("sync-results", ago(0.5), "no_op"), ...three]).status, "healthy");
});

test("daily job: the latest failure is 'failing' and the next success recovers it", () => {
  const failed = [run("sync-fixtures", "2026-11-03T02:16:00Z", "failure", "Discovering due Pick 8 work failed")];
  const state = evaluate("sync-fixtures", failed, { now: at("2026-11-03T03:00:00Z") });
  assert.equal(state.status, "failing");
  assert.equal(state.lastError, "Discovering due Pick 8 work failed");
  const retried = [run("sync-fixtures", "2026-11-03T03:10:00Z"), ...failed];
  assert.equal(evaluate("sync-fixtures", retried, { now: at("2026-11-03T03:11:00Z") }).status, "healthy");
});

test("a run killed mid-flight is a failure only after the stale threshold; a fresh one is ignored", () => {
  const fresh = run("sync-fixtures", "2026-11-03T02:58:00Z", "running");
  assert.equal(effectiveOutcome(fresh, at("2026-11-03T03:00:00Z")), "running");
  assert.equal(evaluate("sync-fixtures", [fresh], { now: at("2026-11-03T03:00:00Z") }).status, "healthy");
  const stale = run("sync-fixtures", "2026-11-03T02:15:00Z", "running");
  assert.equal(effectiveOutcome(stale, at("2026-11-03T02:15:00Z") + RUNNING_STALE_MS + 1), "failure");
  const state = evaluate("sync-fixtures", [stale], { now: at("2026-11-03T03:00:00Z") });
  assert.equal(state.status, "failing");
  assert.equal(state.lastError, "Run did not finish.");
});

test("an in-flight sync-results run does not hide earlier failures but does not count as one either", () => {
  const history = [run("sync-results", ago(1), "running"), ...runs("sync-results", [6, 11, 16], "failure")];
  assert.equal(evaluate("sync-results", history).status, "failing");
  assert.equal(evaluate("sync-results", [run("sync-results", ago(1), "running"), ...runs("sync-results", [6, 11])]).status, "healthy");
});

test("overall health is unhealthy when any single job is missed or failing", () => {
  const healthyResults = runs("sync-results", [2]);
  const daily = (job: Pick8CronJob, iso: string) => [run(job, iso)];
  const base = {
    executionsByJob: {
      "sync-results": healthyResults,
      "sync-fixtures": daily("sync-fixtures", "2026-11-03T02:16:00Z"),
      "reconcile-results": daily("reconcile-results", "2026-11-03T05:31:00Z"),
    },
    lastSuccessByJob: { "sync-results": ago(2), "sync-fixtures": "2026-11-03T02:16:00Z", "reconcile-results": "2026-11-03T05:31:00Z" },
    monitoring: resolveMonitoringBaseline(undefined, "2026-10-01T00:00:00Z"), now: NOW,
  };
  assert.equal(evaluateCronHealth(base).healthy, true);
  const stalled = evaluateCronHealth({ ...base, executionsByJob: { ...base.executionsByJob, "sync-results": runs("sync-results", [40]) } });
  assert.equal(stalled.healthy, false);
  assert.equal(stalled.jobs[0].status, "missed");
  const broken = evaluateCronHealth({ ...base, executionsByJob: { ...base.executionsByJob, "reconcile-results": daily("reconcile-results", "2026-11-03T05:31:00Z").map((r) => ({ ...r, outcome: "failure" as const })) } });
  assert.equal(broken.healthy, false);
});

// --- activation baseline (PICK8_CRON_MONITORING_SINCE) --------------------------------------------

const empty = { "sync-results": [], "sync-fixtures": [], "reconcile-results": [] } as Record<Pick8CronJob, Pick8CronExecution[]>;
const noSuccess = { "sync-results": null, "sync-fixtures": null, "reconcile-results": null } as Record<Pick8CronJob, string | null>;
const health = (since: string | undefined, now: number, executionsByJob = empty, firstRow: string | null = null) =>
  evaluateCronHealth({ executionsByJob, lastSuccessByJob: noSuccess, monitoring: resolveMonitoringBaseline(since, firstRow), now });
const statuses = (h: ReturnType<typeof health>) => Object.fromEntries(h.jobs.map((job) => [job.job, job.status]));

test("baseline resolution: configured wins, then first run, else none; unusable config is flagged, never silently ignored", () => {
  assert.deepEqual(resolveMonitoringBaseline("2026-11-10T00:00:00Z", "2026-11-05T00:00:00Z"), { baselineAt: "2026-11-10T00:00:00.000Z", source: "configured" });
  assert.deepEqual(resolveMonitoringBaseline("2026-11-10T10:00:00+10:00", null), { baselineAt: "2026-11-10T00:00:00.000Z", source: "configured" });
  assert.deepEqual(resolveMonitoringBaseline("  ", "2026-11-05T00:00:00Z"), { baselineAt: "2026-11-05T00:00:00Z", source: "first_run" });
  assert.deepEqual(resolveMonitoringBaseline(undefined, null), { baselineAt: null, source: "none" });
  for (const bad of ["tomorrow", "2026-11-10", "2026-11-10T00:00:00", "1699999999", "2026-13-40T00:00:00Z"]) {
    assert.equal(resolveMonitoringBaseline(bad, null).source, "invalid_config", bad);
  }
});

test("never-seen jobs: with an activation baseline and an EMPTY table, every job is eventually reported missed", () => {
  const since = "2026-11-10T00:00:00Z";
  // Before the baseline, and right after it, nothing is expected.
  assert.deepEqual(Object.values(statuses(health(since, at("2026-11-09T23:00:00Z")))), ["awaiting_first_run", "awaiting_first_run", "awaiting_first_run"]);
  assert.equal(health(since, at("2026-11-10T00:10:00Z")).healthy, true);
  // 15+ minutes later sync-results has never run.
  const later = health(since, at("2026-11-10T00:16:00Z"));
  assert.equal(later.healthy, false);
  assert.equal(statuses(later)["sync-results"], "missed");
  assert.equal(statuses(later)["sync-fixtures"], "awaiting_first_run"); // next 02:15 is still ahead
  // First daily windows after activation: 02:15 + 2 h and 05:30 + 2 h with no rows at all.
  assert.equal(statuses(health(since, at("2026-11-10T04:14:00Z")))["sync-fixtures"], "awaiting_first_run");
  const noon = health(since, at("2026-11-10T12:00:00Z"));
  assert.deepEqual(statuses(noon), { "sync-results": "missed", "sync-fixtures": "missed", "reconcile-results": "missed" });
});

test("activating mid-schedule cannot alert: a daily job is only expected from a due time >= 1 h after activation", () => {
  // Activated at 02:00 UTC, i.e. 15 minutes before sync-fixtures is due: that day's run is not required.
  const since = "2026-11-10T02:00:00Z";
  const rows = { ...empty, "sync-results": runs("sync-results", [2], "success", at("2026-11-10T06:00:00Z")) };
  const state = statuses(health(since, at("2026-11-10T06:00:00Z"), rows));
  assert.equal(state["sync-fixtures"], "awaiting_first_run");
  assert.equal(state["reconcile-results"], "awaiting_first_run"); // 05:30 is expected, but its 07:30 deadline is not reached
  assert.equal(statuses(health(since, at("2026-11-10T08:00:00Z"), { ...rows, "sync-results": runs("sync-results", [2], "success", at("2026-11-10T08:00:00Z")) }))["reconcile-results"], "missed");
});

test("a future activation time keeps everything quiet until it arrives (deploy first, arm later)", () => {
  const h = health("2026-11-20T00:00:00Z", NOW);
  assert.equal(h.healthy, true);
  assert.match(h.jobs[0].reason, /Monitoring starts at 2026-11-20/);
  assert.equal(h.monitoring.source, "configured");
});

test("rows from before activation (testing, earlier deploys) neither count as an attempt nor raise 'failing'", () => {
  const since = "2026-11-03T09:00:00Z"; // NOW is 10:00
  const testing = runs("sync-results", [62, 67, 72], "failure"); // 08:58, 08:53, 08:48: all before activation
  // Silent since activation: missed (the pre-activation attempts do not satisfy it), not 'failing'.
  assert.equal(evaluate("sync-results", testing, { baselineAt: since }).status, "missed");
  // A single post-activation success makes the job healthy, again without the old failures counting.
  assert.equal(evaluate("sync-results", [run("sync-results", ago(3)), ...testing], { baselineAt: since }).status, "healthy");
  // Two post-activation failures + old failures must not reach the 3-failure threshold.
  assert.equal(evaluate("sync-results", [...runs("sync-results", [3, 8], "failure"), ...testing], { baselineAt: since }).status, "healthy");
});

test("an unusable PICK8_CRON_MONITORING_SINCE makes the overall health unhealthy so it cannot silently disarm", () => {
  const h = health("not-a-date", NOW, empty, "2026-10-01T00:00:00Z");
  assert.equal(h.monitoring.source, "invalid_config");
  assert.equal(h.healthy, false);
});

// --- daily schedule boundaries ---------------------------------------------------------------------

test("daily schedules use the actual Vercel cron times in UTC (vercel.json is the source of truth)", () => {
  const crons: { path: string; schedule: string }[] = JSON.parse(readFileSync("vercel.json", "utf8")).crons;
  for (const job of ["sync-fixtures", "reconcile-results"] as const) {
    const schedule = PICK8_CRON_SCHEDULES[job];
    assert.equal(schedule.kind, "daily");
    const cron = crons.find((c) => c.path === `/api/cron/${job}`);
    assert.ok(cron, `${job} must be in vercel.json`);
    const [minute, hour, ...rest] = cron.schedule.split(" ");
    assert.deepEqual(rest, ["*", "*", "*"]);
    if (schedule.kind === "daily") assert.deepEqual([schedule.hourUtc, schedule.minuteUtc], [Number(hour), Number(minute)]);
  }
});

test("daily boundaries: the early-tolerance edge, the run at the deadline, and one millisecond either side", () => {
  const due = at("2026-11-03T02:15:00Z");
  const deadline = due + 2 * 60 * MIN; // 04:15:00.000
  const base = { baselineAt: "2026-10-01T00:00:00Z" };
  const prev = run("sync-fixtures", "2026-11-02T02:16:00Z");
  const status = (startedAt: string, now: number) => evaluate("sync-fixtures", [run("sync-fixtures", startedAt), prev].sort((a, b) => b.started_at.localeCompare(a.started_at)), { ...base, now }).status;
  // Exactly at the deadline an unfulfilled schedule is missed; one ms earlier it is still inside grace.
  assert.equal(evaluate("sync-fixtures", [prev], { ...base, now: deadline - 1 }).status, "healthy");
  assert.equal(evaluate("sync-fixtures", [prev], { ...base, now: deadline }).status, "missed");
  // A run at 01:45:00.000 (30 min early) counts; one ms earlier does not.
  assert.equal(status("2026-11-03T01:45:00.000Z", deadline), "healthy");
  assert.equal(status("2026-11-03T01:44:59.999Z", deadline), "missed");
  // A run that starts at the very last moment of the grace window still satisfies it, and a later one recovers a miss.
  assert.equal(status("2026-11-03T04:14:59.999Z", deadline + MIN), "healthy");
  assert.equal(status("2026-11-03T05:00:00Z", at("2026-11-03T05:01:00Z")), "healthy");
});

test("daily boundaries across a UTC day, month and year change", () => {
  const prev = (job: Pick8CronJob, iso: string) => [run(job, iso)];
  const baselineAt = "2025-01-01T00:00:00Z";
  // 2026-01-01 03:00 UTC: today's 02:15 window is still open, so the 2025-12-31 run satisfies the latest expired schedule.
  assert.equal(evaluate("sync-fixtures", prev("sync-fixtures", "2025-12-31T02:16:00Z"), { baselineAt, now: at("2026-01-01T03:00:00Z") }).status, "healthy");
  // ...and once 04:15 passes without a run it is missed, reported against the 1 Jan schedule.
  const missed = evaluate("sync-fixtures", prev("sync-fixtures", "2025-12-31T02:16:00Z"), { baselineAt, now: at("2026-01-01T04:15:00Z") });
  assert.equal(missed.status, "missed");
  assert.match(missed.reason, /2026-01-01T02:15:00.000Z/);
  // Leap-day/month rollover: 1 March after a run on 28 Feb (2027 is not a leap year).
  assert.equal(evaluate("reconcile-results", prev("reconcile-results", "2027-02-28T05:31:00Z"), { baselineAt, now: at("2027-03-01T06:00:00Z") }).status, "healthy");
  assert.match(evaluate("reconcile-results", prev("reconcile-results", "2027-02-28T05:31:00Z"), { baselineAt, now: at("2027-03-01T07:30:00Z") }).reason, /2027-03-01T05:30:00.000Z/);
});

test("Melbourne daylight saving does not move the schedules: they are fixed UTC instants", () => {
  // 2026-10-04 is the AEST→AEDT switch in Melbourne; the UTC due times must be identical on both sides.
  for (const day of ["2026-10-03", "2026-10-04", "2026-10-05"]) {
    const missed = evaluate("sync-fixtures", [run("sync-fixtures", "2026-09-01T02:16:00Z")], { now: at(`${day}T04:15:00Z`) });
    assert.match(missed.reason, new RegExp(`${day}T02:15:00.000Z`));
  }
});

// --- what cron-job.org sees: poll-by-poll timelines -----------------------------------------------

/** The HTTP status GET /api/cron/health returns for a snapshot. */
const httpStatus = (h: ReturnType<typeof health>) => (h.healthy ? 200 : 503);
const SINCE = "2026-10-01T00:00:00Z";
const DAY = "2026-11-03";
const STEP = 5 * MIN;
const START = at(`${DAY}T08:00:00Z`);
/** Today's daily jobs already ran on schedule, so only sync-results can move the overall status. */
const dailyDone = {
  "sync-fixtures": [run("sync-fixtures", `${DAY}T02:16:00Z`)],
  "reconcile-results": [run("reconcile-results", `${DAY}T05:31:00Z`)],
};
/** sync-results rows (newest first, as the store returns them) for runs every 5 min from 08:00 up to `now`. */
function resultsAt(now: number, outcomeAt: (minuteOffset: number) => Pick8CronOutcome) {
  const rows: Pick8CronExecution[] = [];
  for (let i = 0; START + i * STEP <= now; i++) {
    rows.unshift(run("sync-results", new Date(START + i * STEP).toISOString(), outcomeAt(i * 5)));
  }
  return rows.slice(0, 10);
}
const poll = (hhmm: string, outcomeAt: (minuteOffset: number) => Pick8CronOutcome) => {
  const now = at(`${DAY}T${hhmm}:30Z`);
  return httpStatus(health(SINCE, now, { ...dailyDone, "sync-results": resultsAt(now, outcomeAt) } as typeof empty));
};

test("poll timeline: a one-off failure, a stuck run and no-op runs never produce a 503", () => {
  // 08:30 fails once; 08:50 hangs (stale after 10 min); everything else is a legitimate no-op.
  const outcome = (minute: number): Pick8CronOutcome => (minute === 30 ? "failure" : minute === 50 ? "running" : "no_op");
  for (let t = 8 * 60 + 10; t <= 10 * 60; t += 10) {
    const hhmm = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    assert.equal(poll(hhmm, outcome), 200, hhmm);
  }
});

test("poll timeline: sustained failure goes red after 3 failed runs, stays red, and recovers on the first success", () => {
  // Runs at 08:30–09:05 fail (minute offsets 30..65); 09:10 succeeds.
  const outcome = (minute: number): Pick8CronOutcome => (minute >= 30 && minute < 70 ? "failure" : "success");
  assert.equal(poll("08:30", outcome), 200); // 1 failure
  assert.equal(poll("08:35", outcome), 200); // 2 failures
  assert.equal(poll("08:40", outcome), 503); // 3 consecutive failures
  assert.equal(poll("09:00", outcome), 503);
  assert.equal(poll("09:05", outcome), 503);
  assert.equal(poll("09:10", outcome), 200); // first success: recovered on the very next poll
});

test("poll timeline: a missed scheduler goes red once and recovers as soon as any attempt arrives (even a no-op)", () => {
  const rows = (...r: Pick8CronExecution[]) => ({ ...dailyDone, "sync-results": r } as typeof empty);
  const last = run("sync-results", `${DAY}T08:00:00Z`, "no_op");
  assert.equal(httpStatus(health(SINCE, at(`${DAY}T08:14:00Z`), rows(last))), 200);
  assert.equal(httpStatus(health(SINCE, at(`${DAY}T08:20:00Z`), rows(last))), 503);
  assert.equal(httpStatus(health(SINCE, at(`${DAY}T08:30:00Z`), rows(run("sync-results", `${DAY}T08:29:00Z`, "no_op"), last))), 200);
});

test("a daily job that failed stays red until its next successful run, then recovers", () => {
  const results = runs("sync-results", [2], "no_op", at(`${DAY}T12:00:00Z`));
  const world = (fixtures: Pick8CronExecution[]) => ({ ...dailyDone, "sync-results": results, "sync-fixtures": fixtures } as typeof empty);
  const failed = [run("sync-fixtures", `${DAY}T02:16:00Z`, "failure", "Provider returned 502")];
  assert.equal(httpStatus(health(SINCE, at(`${DAY}T12:00:00Z`), world(failed))), 503);
  assert.equal(httpStatus(health(SINCE, at(`${DAY}T12:00:00Z`), world([run("sync-fixtures", `${DAY}T11:00:00Z`), ...failed]))), 200);
  // Still red the next morning if nobody re-ran it and the new schedule is not yet due; a fresh scheduled success clears it.
  assert.equal(httpStatus(health(SINCE, at("2026-11-04T03:00:00Z"), { ...world(failed), "sync-results": runs("sync-results", [2], "no_op", at("2026-11-04T03:00:00Z")) })), 503);
});
