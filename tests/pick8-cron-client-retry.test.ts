import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type * as AdminModule from "../utils/supabase/admin";
import type * as CronReadModule from "../utils/supabase/cron-read";

// Real admin.ts + cron-read.ts + jwt-skew-retry.ts; only the Supabase SDK constructor and the network are faked.
const root = resolve(import.meta.dirname, "..");
const nativeRequire = createRequire(import.meta.url);
const skew = () => Response.json({ code: "PGRST303", message: "JWT issued at future" }, { status: 401 });
const ok = () => Response.json([{ id: 1 }], { status: 200 });

function load() {
  const captured: { fetch?: typeof fetch }[] = [];
  const holder: { context?: ReturnType<typeof CronReadModule.createCronReadContext> } = {};
  const cache = new Map<string, unknown>();
  const stubs: Record<string, unknown> = {
    "server-only": {},
    "@supabase/supabase-js": { createClient: (_url: string, _key: string, options: { global?: { fetch?: typeof fetch } }) => { captured.push({ fetch: options.global?.fetch }); return {}; } },
    "@/utils/supabase/resilience": { createSupabaseServerFetch: () => ({ fetch }) },
  };
  function loadFile(file: string): unknown {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const require = (id: string): unknown => {
      if (id in stubs) return stubs[id];
      if (id.startsWith("@/")) return loadFile(resolve(root, `${id.slice(2)}.ts`));
      if (id.startsWith(".")) return loadFile(resolve(dirname(file), id.endsWith(".ts") ? id : `${id}.ts`));
      return nativeRequire(id);
    };
    runInNewContext(source, {
      exports, module: { exports }, require, process, Response, Request, URL, URLSearchParams, Uint8Array, ArrayBuffer, AbortSignal, AbortController,
      Date, Math, Promise, Map, Set, Error, JSON, console, performance, crypto, setTimeout, clearTimeout, Infinity, fetch: globalThis.fetch,
    }, { filename: file });
    return exports;
  }
  // The real cron-read module, but the invocation context is the one the test hands in (the real store is an
  // AsyncLocalStorage that only withCronReadContext can fill, with a fixed budget).
  const cron = loadFile(resolve(root, "utils/supabase/cron-read.ts")) as typeof CronReadModule;
  stubs["@/utils/supabase/cron-read"] = { ...cron, currentCronReadContext: () => holder.context };
  return { admin: loadFile(resolve(root, "utils/supabase/admin.ts")) as typeof AdminModule, cron, captured, holder };
}

/** A fake PostgREST: rejected requests never execute; accepted ones count as one execution. */
function server(script: (() => Response)[]) {
  const calls: { method?: string; body?: unknown }[] = [];
  const executed: unknown[] = [];
  let i = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    calls.push({ method: init?.method, body: init?.body });
    const response = script[Math.min(i++, script.length - 1)]();
    if (response.status < 400) executed.push(init?.body ?? "read");
    return response;
  }) as typeof fetch;
  return { calls, executed, restore: () => { globalThis.fetch = original; } };
}

const env = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "test-key-not-real" };

async function withEnv<T>(work: () => Promise<T> | T) {
  const previous = { ...process.env };
  Object.assign(process.env, env);
  const warn = console.warn; console.warn = () => {};
  try { return await work(); } finally {
    console.warn = warn;
    for (const key of Object.keys(env)) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
}

/** Runs `work` with a cron client whose invocation context is built from `ctxOptions`. */
function inCron<T>(ctxOptions: Record<string, unknown>, work: (client: typeof fetch, h: ReturnType<typeof load>) => Promise<T>) {
  return withEnv(async () => {
    const h = load();
    h.holder.context = h.cron.createCronReadContext({ log: () => {}, ...ctxOptions });
    h.admin.createAdminClient();
    return work(h.captured[0].fetch!, h);
  });
}

test("inside a cron run, a PGRST303 rejection on the job's own call is replayed and recovers", async () => {
  const net = server([skew, ok]);
  try {
    await inCron({}, async (f) => {
      const response = await f("https://x.supabase.co/rest/v1/rpc/discover_pick8_due_work", { method: "POST", body: "{}" });
      assert.equal(response.status, 200);
    });
    assert.equal(net.calls.length, 2);
  } finally { net.restore(); }
});

test("a rejected write is never executed twice: only the accepted replay runs, with the same body", async () => {
  const net = server([skew, ok]);
  try {
    await inCron({}, async (f) => {
      await f("https://x.supabase.co/rest/v1/rpc/score_pick8_matchday", { method: "POST", body: '{"check_scoring_revision":7}' });
    });
    assert.deepEqual(net.executed, ['{"check_scoring_revision":7}']);
    assert.equal(net.calls[1].body, '{"check_scoring_revision":7}');
  } finally { net.restore(); }
});

test("retries are bounded: two replays, then the original rejection surfaces unchanged", async () => {
  const net = server([skew, skew, skew, ok]);
  try {
    await inCron({}, async (f) => {
      const response = await f("https://x.supabase.co/rest/v1/t", { method: "POST", body: "{}" });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).code, "PGRST303");
    });
    assert.equal(net.calls.length, 3);
    assert.equal(net.executed.length, 0);
  } finally { net.restore(); }
});

test("every replay goes back through the cron deadline fetch, so it is counted against the invocation", async () => {
  const net = server([skew, skew, ok]);
  try {
    let counted = 0;
    await inCron({}, async (f, h) => {
      const context = h.holder.context!;
      const original = context.countDbRequest;
      context.countDbRequest = () => { counted++; original(); };
      assert.equal((await f("https://x.supabase.co/rest/v1/t", { method: "POST", body: "{}" })).status, 200);
    });
    assert.equal(counted, 3);
  } finally { net.restore(); }
});

test("deadline: no replay when the remaining budget cannot cover the backoff plus the reserve", async () => {
  const net = server([skew, ok]);
  try {
    await inCron({ budgetMs: 1_100 }, async (f) => {
      const response = await f("https://x.supabase.co/rest/v1/t", { method: "POST", body: "{}" });
      assert.equal(response.status, 401);
    });
    assert.equal(net.calls.length, 1);
  } finally { net.restore(); }
});

test("deadline: once the invocation budget is exhausted a replay is refused by the deadline fetch", async () => {
  const net = server([skew, ok]);
  try {
    await inCron({ budgetMs: 25 }, async (f) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      await assert.rejects(f("https://x.supabase.co/rest/v1/t", { method: "POST", body: "{}" }), /deadline|abort/i);
    });
    assert.equal(net.calls.length, 0);
  } finally { net.restore(); }
});

test("cancellation: aborting the invocation during the backoff stops the replay", async () => {
  const net = server([skew, ok]);
  const controller = new AbortController();
  try {
    await inCron({ signal: controller.signal }, async (f) => {
      const pending = f("https://x.supabase.co/rest/v1/t", { method: "POST", body: "{}" });
      setTimeout(() => controller.abort(), 50);
      const response = await pending;
      assert.equal(response.status, 401);
    });
    assert.equal(net.calls.length, 1);
  } finally { net.restore(); }
});

test("a caller-supplied abort signal is honoured during the backoff", async () => {
  const net = server([skew, ok]);
  try {
    await inCron({}, async (f) => {
      const response = await f("https://x.supabase.co/rest/v1/t", { method: "POST", body: "{}", signal: AbortSignal.timeout(40) });
      assert.equal(response.status, 401);
    });
    assert.equal(net.calls.length, 1);
  } finally { net.restore(); }
});

test("other errors are untouched: wrong key, forbidden, SQL errors, 5xx and non-JSON bodies are not replayed", async () => {
  for (const response of [
    () => Response.json({ message: "Invalid API key" }, { status: 401 }),
    () => Response.json({ code: "42501", message: "permission denied" }, { status: 403 }),
    () => Response.json({ code: "P0001", message: "Scoring deferred" }, { status: 400 }),
    () => new Response("bad gateway", { status: 502 }),
    () => new Response("nope", { status: 401 }),
  ]) {
    const net = server([response, ok]);
    try {
      await inCron({}, async (f) => { await f("https://x.supabase.co/rest/v1/t", { method: "POST", body: "{}" }); });
      assert.equal(net.calls.length, 1);
    } finally { net.restore(); }
  }
});

test("transport errors still propagate to the existing cron retry layer, unchanged", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }); }) as typeof fetch;
  try {
    await inCron({}, async (f) => { await assert.rejects(f("https://x.supabase.co/rest/v1/t"), /fetch failed/); });
  } finally { globalThis.fetch = original; }
});

test("outside a cron run the admin client is exactly as before: no custom fetch", async () => {
  await withEnv(async () => {
    const h = load();
    h.admin.createAdminClient();
    assert.equal(h.captured[0].fetch, undefined);
  });
});

test("a caller-supplied wrapper (the monitoring client) is not wrapped a second time inside a cron run", async () => {
  const net = server([skew, skew, skew, ok]);
  try {
    await withEnv(async () => {
      const h = load();
      h.holder.context = h.cron.createCronReadContext({ log: () => {} });
      let wrapped = 0;
      h.admin.createAdminClient({ wrapFetch: (base) => { wrapped++; return base; } });
      const response = await h.captured[0].fetch!("https://x.supabase.co/rest/v1/t", { method: "POST", body: "{}" });
      assert.equal(response.status, 401);
      assert.equal(wrapped, 1);
    });
    assert.equal(net.calls.length, 1, "the caller's wrapper decides; no implicit replay is added");
  } finally { net.restore(); }
});

test("the interactive (page) admin client is not changed", () => {
  const source = readFileSync(resolve(root, "utils/supabase/admin.ts"), "utf8");
  const interactive = source.slice(source.indexOf("export function createInteractiveAdminClient"));
  assert.doesNotMatch(interactive, /retryOnJwtIssuedInFuture|retryWithinCronDeadline/);
});
