import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  recordCronExecution,
  type CronExecutionFinish,
  type CronExecutionStore,
} from "../utils/pick8-cron-executions.ts";
import type * as HealthRoute from "../app/api/cron/health/route";
import type * as StoreModule from "../utils/pick8-cron-executions-store";

// --- recorder -------------------------------------------------------------------------------------

type Call = { op: string; id?: string; finish?: CronExecutionFinish };
function fakeStore(overrides: Partial<CronExecutionStore> = {}) {
  const calls: Call[] = [];
  const store: CronExecutionStore = {
    async start() { calls.push({ op: "start" }); return "row-1"; },
    async finish(id, finish) { calls.push({ op: "finish", id, finish }); },
    async insertFinished(_job, _startedAt, finish) { calls.push({ op: "insertFinished", finish }); },
    ...overrides,
  };
  return { store, calls };
}
const quiet = { log: () => {} };

test("a successful run is recorded start → finish and its result is returned untouched", async () => {
  const { store, calls } = fakeStore();
  const body = { ok: true, complete: true, skipped: false, matchdaysAttempted: [5], failures: [], deferred: [] };
  assert.equal(await recordCronExecution("sync-results", async () => body, { store, ...quiet }), body);
  assert.deepEqual(calls.map((c) => c.op), ["start", "finish"]);
  assert.equal(calls[1].id, "row-1");
  assert.equal(calls[1].finish?.outcome, "success");
});

test("a nothing-due run is recorded as a no-op, not a failure", async () => {
  const { store, calls } = fakeStore();
  await recordCronExecution("sync-results", async () => ({ ok: true, skipped: true, reason: "No matchday currently needs a result check." }), { store, ...quiet });
  assert.equal(calls[1].finish?.outcome, "no_op");
});

test("a business failure returned as HTTP 200 / ok:false is recorded as a failure and still returned", async () => {
  const { store, calls } = fakeStore();
  const body = { ok: false, matchdaysAttempted: [5], failures: [{ matchday: 5, error: "Provider returned 502" }], deferred: [] };
  const result = await recordCronExecution("reconcile-results", async () => body, { store, ...quiet });
  assert.equal(result, body);
  assert.equal(calls[1].finish?.outcome, "failure");
  assert.equal(calls[1].finish?.error, "Provider returned 502");
});

test("a thrown error is recorded as a failure and rethrown unchanged", async () => {
  const { store, calls } = fakeStore();
  const boom = new Error("Missing SUPABASE_SECRET_KEY");
  await assert.rejects(recordCronExecution("sync-fixtures", async () => { throw boom; }, { store, ...quiet }), (error) => error === boom);
  assert.equal(calls[1].finish?.outcome, "failure");
  assert.equal(calls[1].finish?.error, "Missing SUPABASE_SECRET_KEY");
});

test("the start marker is written concurrently with the job, so monitoring adds no latency", async () => {
  const order: string[] = [];
  const { store } = fakeStore({ async start() { order.push("start"); return "row-1"; } });
  await recordCronExecution("sync-results", async () => { order.push("run"); return { ok: true }; }, { store, ...quiet });
  assert.deepEqual(order, ["start", "run"]);
});

test("monitoring failure: start insert fails → the job is unaffected and a finished row is written instead", async () => {
  const logs: Record<string, unknown>[] = [];
  const { store, calls } = fakeStore({ async start() { throw new Error("relation does not exist"); } });
  const body = { ok: true, skipped: true };
  assert.equal(await recordCronExecution("sync-results", async () => body, { store, log: (line) => logs.push(line) }), body);
  assert.deepEqual(calls.map((c) => c.op), ["insertFinished"]);
  assert.equal(logs[0].event, "record_failed");
  assert.equal(logs[0].stage, "start");
});

test("monitoring failure: a failed finish is retried once; two failures never throw", async () => {
  let attempts = 0;
  const flaky = fakeStore({ async finish() { attempts++; if (attempts === 1) throw new Error("network"); } });
  await recordCronExecution("sync-results", async () => ({ ok: true }), { store: flaky.store, ...quiet });
  assert.equal(attempts, 2);
  const dead = fakeStore({ async finish() { attempts++; throw new Error("network"); } });
  attempts = 0;
  assert.deepEqual(await recordCronExecution("sync-results", async () => ({ ok: true }), { store: dead.store, ...quiet }), { ok: true });
  assert.equal(attempts, 2);
});

test("monitoring failure: a store that hangs is abandoned after the timeout and the job result still returns", async () => {
  const hang = () => new Promise<never>(() => {});
  const { store } = fakeStore({ start: hang, finish: hang, insertFinished: hang });
  const logs: Record<string, unknown>[] = [];
  const started = Date.now();
  const body = { ok: false, failures: [{ matchday: 1, error: "x" }] };
  assert.equal(await recordCronExecution("sync-results", async () => body, { store, timeoutMs: 20, log: (line) => logs.push(line) }), body);
  assert.ok(Date.now() - started < 1_000);
  assert.ok(logs.some((line) => line.error === "monitor timeout"));
});

test("monitoring failure: every store method and the logger throwing still cannot affect the job", async () => {
  const fail = async () => { throw new Error("down"); };
  const { store } = fakeStore({ start: fail, finish: fail, insertFinished: fail });
  const body = { ok: true };
  assert.equal(await recordCronExecution("sync-results", async () => body, { store, log: () => { throw new Error("log down"); } }), body);
});

// --- response-path latency: completion bookkeeping is deferred -----------------------------------

function deferral() {
  const tasks: (() => Promise<void>)[] = [];
  return { tasks, defer: (task: () => Promise<void>) => { tasks.push(task); } };
}

test("with defer, the job result is returned before any completion write; running the deferred task records it", async () => {
  const { store, calls } = fakeStore();
  const { tasks, defer } = deferral();
  let clock = 1_000;
  const body = { ok: false, failures: [{ matchday: 5, error: "Provider returned 502" }] };
  const result = await recordCronExecution("sync-results", async () => { clock += 250; return body; }, { store, defer, now: () => clock, ...quiet });
  assert.equal(result, body);
  assert.equal(tasks.length, 1);
  assert.ok(!calls.some((c) => c.op === "finish"), "no finish write on the response path");
  clock += 60_000; // the deferred task runs much later; the recorded duration must still be the job's
  await tasks[0]();
  assert.deepEqual(calls.map((c) => c.op), ["start", "finish"]);
  assert.equal(calls[1].finish?.outcome, "failure");
  assert.equal(calls[1].finish?.durationMs, 250);
});

test("with defer, a thrown job error is still rethrown immediately and recorded as a failure later", async () => {
  const { store, calls } = fakeStore();
  const { tasks, defer } = deferral();
  const boom = new Error("Discovering due Pick 8 work failed");
  await assert.rejects(recordCronExecution("sync-fixtures", async () => { throw boom; }, { store, defer, ...quiet }), (error) => error === boom);
  await tasks[0]();
  assert.equal(calls[1].finish?.outcome, "failure");
  assert.equal(calls[1].finish?.error, "Discovering due Pick 8 work failed");
});

test("if deferral is unavailable (throws), completion is recorded inline so the attempt is never lost", async () => {
  const { store, calls } = fakeStore();
  const defer = () => { throw new Error("after was called outside a request scope"); };
  assert.deepEqual(await recordCronExecution("sync-results", async () => ({ ok: true }), { store, defer, ...quiet }), { ok: true });
  assert.deepEqual(calls.map((c) => c.op), ["start", "finish"]);
});

test("a deferred task never rejects, even when every store call fails", async () => {
  const fail = async () => { throw new Error("down"); };
  const { store } = fakeStore({ start: fail, finish: fail, insertFinished: fail });
  const { tasks, defer } = deferral();
  await recordCronExecution("sync-results", async () => ({ ok: true }), { store, defer, ...quiet });
  await assert.doesNotReject(tasks[0]());
});

test("latency under a hung monitoring database: the response path is ~0 with defer, but the whole tail without it", async () => {
  const hang = () => new Promise<never>(() => {});
  const timeoutMs = 60;
  const time = async (deps: Partial<Parameters<typeof recordCronExecution>[2]>) => {
    const { store } = fakeStore({ start: hang, finish: hang, insertFinished: hang });
    const began = Date.now();
    await recordCronExecution("sync-results", async () => ({ ok: true, skipped: true }), { store, timeoutMs, ...quiet, ...deps });
    return Date.now() - began;
  };
  const { tasks, defer } = deferral();
  const deferred = await time({ defer });
  const inline = await time({});
  assert.ok(deferred < timeoutMs / 2, `deferred response path took ${deferred} ms`);
  assert.ok(inline >= timeoutMs, `inline path took ${inline} ms`);
  const began = Date.now();
  await tasks[0](); // the bounded bookkeeping still completes (and gives up) off the response path
  assert.ok(Date.now() - began < 10 * timeoutMs);
});

// --- wiring: routes ------------------------------------------------------------------------------

test("each Pick8 cron route authorizes first, then records the run through monitoredCron", () => {
  for (const [route, fn] of [["sync-results", "runConditionalResultSync"], ["sync-fixtures", "runDailyFixtureSync"], ["reconcile-results", "runResultReconciliation"]]) {
    const source = readFileSync(`app/api/cron/${route}/route.ts`, "utf8");
    assert.ok(source.indexOf("authorizePick8Cron(request)") < source.indexOf(`monitoredCron("${route}", ${fn})`), route);
    assert.ok(source.includes("status: 500"), "unexpected errors keep their 500 response");
  }
});

// --- health endpoint -------------------------------------------------------------------------------

const SECRET = "health-test-secret-0123456789";

function loadModule<T>(entry: string, stubs: Record<string, unknown>): T {
  const nativeRequire = createRequire(import.meta.url);
  const modules = new Map<string, unknown>();
  function load(name: string): unknown {
    const path = resolve(name);
    if (modules.has(path)) return modules.get(path);
    const exports = {};
    modules.set(path, exports);
    const source = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const require = (id: string): unknown => {
      if (id in stubs) return stubs[id];
      if (id === "server-only") return {};
      if (id === "next/server") return { NextResponse: Response };
      if (id === "@/utils/pick8-cron-monitor") return load("utils/pick8-cron-monitor.ts");
      if (id === "@/utils/pick8-cron-executions") return load("utils/pick8-cron-executions.ts");
      if (id.startsWith("./pick8-cron-monitor")) return load("utils/pick8-cron-monitor.ts");
      if (id.startsWith("@/")) return new Proxy({}, { get: () => () => { throw new Error(`unexpected import ${id}`); } });
      return nativeRequire(id);
    };
    runInNewContext(source, {
      exports, module: { exports }, require, Map, Set, URL, Response, Date, process, console, performance, AbortSignal,
      setTimeout, clearTimeout, Promise, Error, JSON,
    }, { filename: path });
    return exports;
  }
  return load(entry) as T;
}

// Stand-in for authorizePick8Cron (its real contract is covered by pick8-cron-auth.test.ts): the health route's
// own obligation is to call it first and return its response untouched.
function authStub() {
  return {
    authorizePick8Cron(request: Request) {
      const secret = process.env.CRON_SECRET;
      if (!secret) return Response.json({ ok: false }, { status: 500 });
      const header = request.headers.get("authorization");
      if (!header) return Response.json({ ok: false }, { status: 401 });
      return header === `Bearer ${secret}` ? null : Response.json({ ok: false }, { status: 403 });
    },
  };
}

function healthRoute(loadCronHealth: () => Promise<unknown>) {
  return loadModule<typeof HealthRoute>("app/api/cron/health/route.ts", {
    "@/utils/pick8-cron-automation": authStub(),
    "@/utils/pick8-cron-executions-store": { loadCronHealth },
  });
}
const get = (authorization?: string) => new Request("https://pick8.test/api/cron/health", authorization ? { headers: { authorization } } : {});
const snapshot = (healthy: boolean) => ({
  health: {
    healthy, checkedAt: "2026-11-03T10:00:00.000Z", monitoring: { since: "2026-11-01T00:00:00.000Z", source: "configured" },
    jobs: [{ job: "sync-results", schedule: "Every 5 minutes", status: healthy ? "healthy" : "missed", reason: healthy ? "Running as scheduled." : "No run since x.", lastAttemptAt: "x", lastSuccessAt: "y", lastOutcome: "success", lastError: "secret provider detail" }],
  },
  executionsByJob: {},
});

test("the health route authorizes before doing any work, like the cron routes", () => {
  const source = readFileSync("app/api/cron/health/route.ts", "utf8");
  assert.ok(source.indexOf("authorizePick8Cron(request)") > 0);
  assert.ok(source.indexOf("authorizePick8Cron(request)") < source.indexOf("await "));
  assert.doesNotMatch(source, /searchParams|\.url/, "no query-string input is read");
});

test("health endpoint: same Bearer credential as the cron routes, fail closed, and no history read when unauthorized", async () => {
  const previous = process.env.CRON_SECRET;
  let reads = 0;
  const { GET } = healthRoute(async () => { reads++; return snapshot(true); });
  const originalWarn = console.warn, originalError = console.error;
  console.warn = () => {}; console.error = () => {};
  try {
    process.env.CRON_SECRET = SECRET;
    assert.equal((await GET(get())).status, 401);
    assert.equal((await GET(get("Bearer wrong"))).status, 403);
    assert.equal((await GET(new Request(`https://pick8.test/api/cron/health?token=${SECRET}`))).status, 401);
    delete process.env.CRON_SECRET;
    assert.equal((await GET(get(`Bearer ${SECRET}`))).status, 500);
    assert.equal(reads, 0);
  } finally {
    console.warn = originalWarn; console.error = originalError;
    if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
  }
});

test("health endpoint: 200 when healthy, 503 when a job is unhealthy, never leaking error text", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
  try {
    const ok = await healthRoute(async () => snapshot(true)).GET(get(`Bearer ${SECRET}`));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    const okBody = await ok.json();
    assert.equal(okBody.ok, true);
    assert.equal(okBody.status, "healthy");
    assert.deepEqual(okBody.monitoring, { since: "2026-11-01T00:00:00.000Z", source: "configured" });

    const bad = await healthRoute(async () => snapshot(false)).GET(get(`Bearer ${SECRET}`));
    assert.equal(bad.status, 503);
    const badText = JSON.stringify(await bad.json());
    assert.match(badText, /"status":"unhealthy"/);
    assert.match(badText, /No run since/);
    assert.doesNotMatch(badText, /secret provider detail|lastError/);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
  }
});

test("health endpoint: unreadable history is 503 'unavailable' (not a false 'healthy') and does not throw", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await healthRoute(async () => { throw new Error("Cron history unreadable: timeout"); }).GET(get(`Bearer ${SECRET}`));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, status: "unavailable" });
  } finally {
    console.error = originalError;
    if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
  }
});

// --- store queries ---------------------------------------------------------------------------------

type Row = Record<string, unknown>;
function fakeAdminClient(rows: Row[], failReads = false) {
  const writes: { op: string; row: Row }[] = [];
  function query(filters: ((row: Row) => boolean)[] = [], order: { column: string; ascending: boolean } | null = null, limit = Infinity) {
    const run = () => {
      if (failReads) return { data: null, error: { message: "read timeout" } };
      let result = rows.filter((row) => filters.every((f) => f(row)));
      if (order) result = [...result].sort((a, b) => String(a[order.column]).localeCompare(String(b[order.column])) * (order.ascending ? 1 : -1));
      return { data: result.slice(0, limit), error: null };
    };
    const builder: Record<string, unknown> = {
      eq: (column: string, value: unknown) => query([...filters, (row) => row[column] === value], order, limit),
      in: (column: string, values: unknown[]) => query([...filters, (row) => values.includes(row[column])], order, limit),
      order: (column: string, options: { ascending: boolean }) => query(filters, { column, ascending: options.ascending }, limit),
      limit: (n: number) => query(filters, order, n),
      abortSignal: () => builder,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  }
  return {
    writes,
    client: {
      from: () => ({
        select: () => query(),
        insert: (row: Row) => { writes.push({ op: "insert", row }); return { select: () => ({ abortSignal: () => ({ single: async () => ({ data: { id: "new-id" }, error: null }) }) }), abortSignal: async () => ({ error: null }) }; },
        update: (row: Row) => ({ eq: () => ({ abortSignal: async () => { writes.push({ op: "update", row }); return { error: null }; } }) }),
      }),
    },
  };
}
const exec = (job: string, startedAt: string, outcome = "success") => ({ job, started_at: startedAt, finished_at: startedAt, outcome, duration_ms: 1, error: null, summary: {} });

function loadStore(client: unknown, deferred: (() => Promise<void>)[] = []) {
  return loadModule<typeof StoreModule>("utils/pick8-cron-executions-store.ts", {
    "@/utils/supabase/admin": { createAdminClient: () => client },
    "next/server": { NextResponse: Response, after: (task: () => Promise<void>) => { deferred.push(task); } },
  });
}

test("store: derives health and the bootstrap baseline from stored rows, and last success ignores newer failures", async () => {
  const now = Date.parse("2026-11-03T10:00:00Z");
  const rows = [
    exec("sync-results", "2026-11-03T09:58:00Z"),
    exec("sync-results", "2026-11-03T09:53:00Z", "no_op"),
    exec("sync-fixtures", "2026-11-03T02:16:00Z"),
    exec("reconcile-results", "2026-11-02T05:31:00Z"),
    exec("reconcile-results", "2026-11-03T05:32:00Z", "failure"),
  ];
  const { loadCronHealth } = loadStore(fakeAdminClient(rows).client);
  const { health, executionsByJob } = await loadCronHealth(now, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(health.monitoring)), { since: "2026-11-02T05:31:00Z", source: "first_run" });
  const byJob = Object.fromEntries(health.jobs.map((job) => [job.job, job]));
  assert.equal(byJob["sync-results"].status, "healthy");
  assert.equal(byJob["sync-fixtures"].status, "healthy");
  assert.equal(byJob["reconcile-results"].status, "failing");
  assert.equal(byJob["reconcile-results"].lastSuccessAt, "2026-11-02T05:31:00Z");
  assert.equal(health.healthy, false);
  assert.equal(executionsByJob["sync-results"].length, 2);
});

test("store: a read failure throws rather than reporting 'healthy'", async () => {
  const { loadCronHealth } = loadStore(fakeAdminClient([], true).client);
  await assert.rejects(loadCronHealth(), /Cron history unreadable/);
});

test("store: monitoredCron records the start alongside the job, completes in after(), and never changes the result", async () => {
  const fake = fakeAdminClient([]);
  const deferred: (() => Promise<void>)[] = [];
  const { monitoredCron } = loadStore(fake.client, deferred);
  const body = { ok: false, failures: [{ matchday: 5, error: "boom" }] };
  assert.equal(await monitoredCron("sync-results", async () => body), body);
  assert.deepEqual(fake.writes.map((w) => w.op), ["insert"], "only the start marker is written before the response");
  assert.equal(fake.writes[0].row.outcome, "running");
  assert.equal(deferred.length, 1);
  await deferred[0]();
  assert.deepEqual(fake.writes.map((w) => w.op), ["insert", "update"]);
  assert.equal(fake.writes[1].row.outcome, "failure");
});

test("store: outside a request scope (after() throws) the attempt is still completed inline", async () => {
  const fake = fakeAdminClient([]);
  const { monitoredCron } = loadModule<typeof StoreModule>("utils/pick8-cron-executions-store.ts", {
    "@/utils/supabase/admin": { createAdminClient: () => fake.client },
    "next/server": { NextResponse: Response, after: () => { throw new Error("outside request scope"); } },
  });
  await monitoredCron("sync-results", async () => ({ ok: true, skipped: true }));
  assert.deepEqual(fake.writes.map((w) => w.op), ["insert", "update"]);
  assert.equal(fake.writes[1].row.outcome, "no_op");
});

test("store: an EMPTY table with an activation baseline reports every never-started job as missed", async () => {
  const { loadCronHealth } = loadStore(fakeAdminClient([]).client);
  const quiet = await loadCronHealth(Date.parse("2026-11-10T00:10:00Z"), "2026-11-10T00:00:00Z");
  assert.equal(quiet.health.healthy, true);
  const silent = await loadCronHealth(Date.parse("2026-11-10T12:00:00Z"), "2026-11-10T00:00:00Z");
  assert.equal(silent.health.healthy, false);
  assert.deepEqual(JSON.parse(JSON.stringify(silent.health.jobs.map((job) => job.status))), ["missed", "missed", "missed"]);
  // Without the env var an empty table stays quiet (nothing recorded, nothing configured) and says so.
  const unarmed = await loadCronHealth(Date.parse("2026-11-10T12:00:00Z"), undefined);
  assert.equal(unarmed.health.healthy, true);
  assert.equal(unarmed.health.monitoring.source, "none");
  // An env value that cannot be parsed is surfaced, not ignored.
  assert.equal((await loadCronHealth(Date.parse("2026-11-10T12:00:00Z"), "soon")).health.healthy, false);
});
