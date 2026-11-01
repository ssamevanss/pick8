import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  AUTH_REJECTION_LOG_WINDOW_MS,
  checkPick8CronAuthorization,
  resetPick8CronAuthLogThrottle,
} from "../utils/pick8-cron-auth.ts";
import type * as CronModule from "../utils/pick8-cron-automation";

const SECRET = "s3cret-value-for-tests-0123456789";
const URL_BASE = "https://pick8.test/api/cron/sync-results";

function request(authorization?: string, url = URL_BASE) {
  return new Request(url, authorization === undefined ? {} : { headers: { authorization } });
}

function capture() {
  const lines: { level: string; text: string; json: Record<string, unknown> }[] = [];
  const record = (level: string) => (text: string) => lines.push({ level, text, json: JSON.parse(text) });
  mock.method(console, "warn", record("warn"));
  mock.method(console, "error", record("error"));
  mock.method(console, "info", record("info"));
  return lines;
}

test.beforeEach(() => resetPick8CronAuthLogThrottle());
test.afterEach(() => mock.restoreAll());

test("accepts the exact bearer credential without logging", () => {
  const lines = capture();
  assert.equal(checkPick8CronAuthorization(request(`Bearer ${SECRET}`), SECRET), null);
  assert.deepEqual(lines, []);
});

test("missing Authorization header is 401", () => {
  const lines = capture();
  for (const req of [request(), request("")]) {
    assert.deepEqual(checkPick8CronAuthorization(req, SECRET, 0), {
      status: 401, error: "Authorization header is required.", reason: "missing_authorization",
    });
  }
  assert.equal(lines[0].json.reason, "missing_authorization");
});

test("incorrect credential is 403", () => {
  const rejection = checkPick8CronAuthorization(request("Bearer wrong-secret"), SECRET);
  assert.deepEqual(rejection, { status: 403, error: "Cron authorization is invalid.", reason: "invalid_token" });
});

test("malformed Authorization headers are 403 and never accepted", () => {
  const malformed = [
    SECRET, // no scheme
    `Basic ${SECRET}`,
    `bearer ${SECRET}`, // scheme is case-sensitive, as before
    `Bearer  ${SECRET}`,
    "Bearer",
    "Bearer ",
    `Bearer ${SECRET},Bearer ${SECRET}`,
  ];
  for (const header of malformed) {
    let rejection;
    try { rejection = checkPick8CronAuthorization(request(header), SECRET, 0); } catch { continue; } // header the runtime itself refuses
    assert.equal(rejection?.status, 403, JSON.stringify(header));
  }
  assert.equal(checkPick8CronAuthorization(request(SECRET), SECRET, 1e9)?.reason, "malformed_authorization");
  assert.equal(checkPick8CronAuthorization(request("Bearer wrong"), SECRET, 2e9)?.reason, "invalid_token");
});

test("tokens of any length are rejected safely, including prefixes and extensions of the secret", () => {
  for (const token of ["x", SECRET.slice(0, -1), `${SECRET}x`, SECRET.slice(1), "x".repeat(100_000)]) {
    assert.equal(checkPick8CronAuthorization(request(`Bearer ${token}`), SECRET, 0)?.status, 403);
  }
});

test("non-ASCII secrets and tokens compare correctly", () => {
  assert.equal(checkPick8CronAuthorization(request("Bearer pässwörd"), "pässwörd"), null);
  assert.equal(checkPick8CronAuthorization(request("Bearer passwörd"), "pässwörd", 0)?.status, 403);
});

test("missing server-side secret fails closed with 500, even for a request that sends a credential", () => {
  const lines = capture();
  for (const secret of [undefined, ""]) {
    for (const header of [undefined, "Bearer ", "Bearer undefined", "Bearer "]) {
      assert.deepEqual(checkPick8CronAuthorization(request(header), secret, 0), {
        status: 500, error: "Cron authentication is not configured.", reason: "secret_not_configured",
      });
    }
  }
  assert.equal(lines[0].level, "error");
});

test("reads CRON_SECRET from the environment by default", () => {
  const previous = process.env.CRON_SECRET;
  try {
    process.env.CRON_SECRET = SECRET;
    assert.equal(checkPick8CronAuthorization(request(`Bearer ${SECRET}`)), null);
    assert.equal(checkPick8CronAuthorization(request("Bearer nope"))?.status, 403);
    delete process.env.CRON_SECRET;
    assert.equal(checkPick8CronAuthorization(request(`Bearer ${SECRET}`))?.status, 500);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
  }
});

test("rejections log route, status and reason but never credentials, headers or query strings", () => {
  const lines = capture();
  const attacker = "Bearer attacker-supplied-token-ABC123";
  const querySecret = "query-secret-XYZ789";
  checkPick8CronAuthorization(request(attacker, `${URL_BASE}?token=${querySecret}&x=1`), SECRET, 0);
  checkPick8CronAuthorization(request(`Bearer ${SECRET.slice(0, -2)}`, URL_BASE), SECRET, 2 * AUTH_REJECTION_LOG_WINDOW_MS);
  checkPick8CronAuthorization(request(undefined, `${URL_BASE}?token=${querySecret}`), SECRET, 0);
  checkPick8CronAuthorization(request("Basic abc", URL_BASE), undefined, 0);
  assert.equal(lines.length, 4);
  assert.deepEqual(lines[0].json, {
    service: "pick8-cron", event: "auth_rejected", route: "sync-results", success: false, status: 403, reason: "invalid_token",
  });
  const everything = lines.map((line) => line.text).join("\n");
  for (const forbidden of [SECRET, SECRET.slice(0, -2), "attacker-supplied", "ABC123", querySecret, "token=", "Basic abc", "Bearer", "https://", "?"]) {
    assert.ok(!everything.toLowerCase().includes(forbidden.toLowerCase()), `log leaked ${forbidden}`);
  }
  assert.deepEqual(lines.map((line) => line.level), ["warn", "warn", "warn", "error"]);
});

test("route comes only from a well-formed /api/cron/<job> path", () => {
  const lines = capture();
  checkPick8CronAuthorization(request("Bearer x", "https://pick8.test/api/cron/reconcile-results"), SECRET, 0);
  checkPick8CronAuthorization(request("Bearer x", "https://pick8.test/some/other/%0Apath"), SECRET, 0);
  assert.deepEqual(lines.map((line) => line.json.route), ["reconcile-results", "unknown"]);
});

test("repeated rejections are throttled per route and reason, with a suppressed count on the next line", () => {
  const lines = capture();
  const call = (at: number, header = "Bearer x", url = URL_BASE) =>
    checkPick8CronAuthorization(request(header, url), SECRET, at);
  for (let i = 0; i < 50; i++) assert.equal(call(i * 100)?.status, 403);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].json.suppressed, undefined);
  // A different reason or route is a different key and still logs.
  call(1000, "Basic x");
  call(1000, "Bearer x", "https://pick8.test/api/cron/sync-fixtures");
  assert.equal(lines.length, 3);
  // After the window the next rejection logs once more, reporting how many were dropped.
  call(AUTH_REJECTION_LOG_WINDOW_MS + 1);
  assert.equal(lines.length, 4);
  assert.equal(lines[3].json.suppressed, 49);
  call(AUTH_REJECTION_LOG_WINDOW_MS + 2);
  assert.equal(lines.length, 4);
});

test("throttle state stays bounded", () => {
  const lines = capture();
  for (let i = 0; i < 500; i++) {
    checkPick8CronAuthorization(request("Bearer x", `https://pick8.test/api/cron/job-${i}`), SECRET, 0);
  }
  assert.equal(lines.length, 500); // all distinct keys log once; the map is cleared at the cap rather than growing
});

// --- HTTP behaviour of authorizePick8Cron as the three cron routes use it -----------------------

function loadCron() {
  const nativeRequire = createRequire(import.meta.url);
  const modules = new Map<string, unknown>();
  function load<T>(name: string): T {
    const path = resolve(name);
    if (modules.has(path)) return modules.get(path) as T;
    const exports = {};
    modules.set(path, exports);
    const source = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const require = (id: string): unknown => {
      if (id === "server-only") return {};
      if (id === "next/server") return { NextResponse: Response };
      if (id === "@/utils/pick8-cron-auth") return load("utils/pick8-cron-auth.ts");
      if (id.startsWith("@/")) return new Proxy({}, { get: () => () => { throw new Error("not used by auth tests"); } });
      return nativeRequire(id);
    };
    runInNewContext(source, {
      exports, module: { exports }, require, Map, Set, URL, Response, Date, process, console, performance, AbortSignal,
      setTimeout, clearTimeout,
    }, { filename: path });
    return exports as T;
  }
  return load<typeof CronModule>("utils/pick8-cron-automation.ts");
}

test("authorizePick8Cron keeps its HTTP contract: null when authorized, JSON {ok:false,error} with 401/403/500 otherwise", async () => {
  capture();
  const previous = process.env.CRON_SECRET;
  try {
    const { authorizePick8Cron } = loadCron();
    process.env.CRON_SECRET = SECRET;
    assert.equal(authorizePick8Cron(request(`Bearer ${SECRET}`)), null);
    const cases: [string | undefined, number, string][] = [
      [undefined, 401, "Authorization header is required."],
      ["Bearer nope", 403, "Cron authorization is invalid."],
      [`Basic ${SECRET}`, 403, "Cron authorization is invalid."],
    ];
    for (const [header, status, error] of cases) {
      const response = authorizePick8Cron(request(header));
      assert.equal(response?.status, status);
      assert.deepEqual(await response!.json(), { ok: false, error });
    }
    // Legacy query-string secrets are still not accepted.
    assert.equal(authorizePick8Cron(request(undefined, `${URL_BASE}?token=${SECRET}`))?.status, 401);
    delete process.env.CRON_SECRET;
    const unconfigured = authorizePick8Cron(request(`Bearer ${SECRET}`));
    assert.equal(unconfigured?.status, 500);
    assert.deepEqual(await unconfigured!.json(), { ok: false, error: "Cron authentication is not configured." });
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
  }
});

test("all three Pick8 cron routes still gate on authorizePick8Cron before doing any work", () => {
  for (const route of ["sync-fixtures", "sync-results", "reconcile-results"]) {
    const source = readFileSync(`app/api/cron/${route}/route.ts`, "utf8");
    const auth = source.indexOf("authorizePick8Cron(request)");
    assert.ok(auth > 0, route);
    assert.ok(auth < source.indexOf("await "), `${route} must authorize before awaiting any work`);
  }
});
