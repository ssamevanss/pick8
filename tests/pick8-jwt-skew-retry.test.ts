import test from "node:test";
import assert from "node:assert/strict";
import { JWT_SKEW_RETRY_DELAYS_MS, retryOnJwtIssuedInFuture } from "../utils/supabase/jwt-skew-retry.ts";

const skew = () => Response.json({ code: "PGRST303", details: null, hint: null, message: "JWT issued at future" }, { status: 401 });
const ok = () => Response.json([{ id: "row" }], { status: 201 });

function harness(responses: (() => Response)[]) {
  const calls: { input: unknown; init?: RequestInit }[] = [];
  const sleeps: number[] = [];
  const logs: Record<string, unknown>[] = [];
  let next = 0;
  const base = (async (input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    return responses[Math.min(next++, responses.length - 1)]();
  }) as unknown as typeof fetch;
  const wrapped = retryOnJwtIssuedInFuture(base, {
    sleep: async (ms) => { sleeps.push(ms); }, log: (line) => logs.push(line),
  });
  return { wrapped, calls, sleeps, logs };
}
const post = { method: "POST", body: JSON.stringify({ job: "sync-results", outcome: "running" }), headers: { apikey: "never-logged" } };

test("a skew rejection is replayed after the first backoff and the caller sees only the success", async () => {
  const { wrapped, calls, sleeps, logs } = harness([skew, ok]);
  const response = await wrapped("https://x.supabase.co/rest/v1/pick8_cron_executions", post);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), [{ id: "row" }]);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [300]);
  assert.equal(calls[1].init?.body, post.body, "the same request body is replayed");
  assert.deepEqual(logs, [{ service: "pick8-cron-monitor", event: "jwt_skew_retry", code: "PGRST303", attempt: 1, delayMs: 300 }]);
});

test("backs off 300 ms then 900 ms and gives up after two retries, returning the last rejection", async () => {
  const { wrapped, calls, sleeps } = harness([skew, skew, skew, ok]);
  const response = await wrapped("https://x.supabase.co/rest/v1/t", post);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "PGRST303");
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [...JWT_SKEW_RETRY_DELAYS_MS]);
});

test("recovers on the second retry", async () => {
  const { wrapped, calls } = harness([skew, skew, ok]);
  assert.equal((await wrapped("https://x.supabase.co/rest/v1/t", post)).status, 201);
  assert.equal(calls.length, 3);
});

test("the rejection is also recognised by message alone", async () => {
  const { wrapped, calls } = harness([() => Response.json({ message: "JWT issued at future" }, { status: 401 }), ok]);
  assert.equal((await wrapped("https://x.supabase.co/rest/v1/t", post)).status, 201);
  assert.equal(calls.length, 2);
});

test("anything else is never retried: other 401s, 4xx/5xx, success, non-JSON bodies", async () => {
  for (const response of [
    () => Response.json({ message: "Invalid API key" }, { status: 401 }),
    () => Response.json({ code: "PGRST303", message: "JWT issued at future" }, { status: 403 }),
    () => Response.json({ code: "42501", message: "permission denied" }, { status: 403 }),
    () => new Response("upstream error", { status: 502 }),
    () => new Response("not json", { status: 401 }),
    ok,
  ]) {
    const { wrapped, calls, sleeps } = harness([response, ok]);
    await wrapped("https://x.supabase.co/rest/v1/t", post);
    assert.equal(calls.length, 1);
    assert.deepEqual(sleeps, []);
  }
});

test("a request that cannot be replayed (streamed body or Request object) is passed through untouched", async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x")); controller.close(); } });
  const streamed = harness([skew, ok]);
  assert.equal((await streamed.wrapped("https://x.supabase.co/rest/v1/t", { method: "POST", body: stream, duplex: "half" } as RequestInit)).status, 401);
  assert.equal(streamed.calls.length, 1);
  const request = harness([skew, ok]);
  assert.equal((await request.wrapped(new Request("https://x.supabase.co/rest/v1/t"))).status, 401);
  assert.equal(request.calls.length, 1);
});

test("reads and bodiless requests are replayed too", async () => {
  const { wrapped, calls } = harness([skew, ok]);
  assert.equal((await wrapped("https://x.supabase.co/rest/v1/t?select=*")).status, 201);
  assert.equal(calls.length, 2);
});

test("an aborted request is not retried, and an abort during the backoff returns the rejection", async () => {
  const controller = new AbortController();
  controller.abort();
  const aborted = harness([skew, ok]);
  assert.equal((await aborted.wrapped("https://x.supabase.co/rest/v1/t", { ...post, signal: controller.signal })).status, 401);
  assert.equal(aborted.calls.length, 1);

  const calls: number[] = [];
  const wrapped = retryOnJwtIssuedInFuture((async () => { calls.push(1); return skew(); }) as unknown as typeof fetch, {
    sleep: async () => { throw new Error("aborted during backoff"); }, log: () => {},
  });
  assert.equal((await wrapped("https://x.supabase.co/rest/v1/t", post)).status, 401);
  assert.equal(calls.length, 1);
});

test("the real sleep honours the caller's timeout, so retries stay inside the monitor's 3 s bound", async () => {
  const base = (async () => skew()) as unknown as typeof fetch;
  const wrapped = retryOnJwtIssuedInFuture(base, { delaysMs: [5_000, 5_000], log: () => {} });
  const began = Date.now();
  const response = await wrapped("https://x.supabase.co/rest/v1/t", { ...post, signal: AbortSignal.timeout(50) });
  assert.equal(response.status, 401);
  assert.ok(Date.now() - began < 1_000);
});

test("a throwing logger or a transport error behaves like the underlying fetch", async () => {
  const noisy = retryOnJwtIssuedInFuture((async () => skew()) as unknown as typeof fetch, {
    sleep: async () => {}, log: () => { throw new Error("log down"); },
  });
  assert.equal((await noisy("https://x.supabase.co/rest/v1/t", post)).status, 401);
  const failing = retryOnJwtIssuedInFuture((async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch);
  await assert.rejects(failing("https://x.supabase.co/rest/v1/t", post), /fetch failed/);
});
