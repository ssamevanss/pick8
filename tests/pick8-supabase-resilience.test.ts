import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyServerAuth,
  createSupabaseServerFetch,
  isServerAuthUnavailable,
  SERVER_AUTH_TIMEOUT_CODE,
  SERVER_AUTH_UNAVAILABLE_CODE,
  SERVER_DATABASE_TIMEOUT_CODE,
  serviceUnavailableResponse,
} from "../utils/supabase/resilience.ts";

test("server auth distinguishes authenticated and invalid sessions", () => {
  assert.deepEqual(
    classifyServerAuth({ user: { id: "player" }, error: null }),
    { kind: "authenticated", user: { id: "player" } },
  );

  const invalid = { name: "AuthApiError", status: 401, code: "bad_jwt" };
  assert.deepEqual(
    classifyServerAuth({ user: null, error: invalid }),
    { kind: "unauthenticated", error: invalid },
  );
  assert.equal(isServerAuthUnavailable(invalid), false);
});

test("a hanging server Auth request is bounded and preserves the session", async () => {
  const timeoutMs = 20;
  const dependencyFetch = createSupabaseServerFetch({
    authTimeoutMs: timeoutMs,
    fetchImpl: async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      }),
  });
  const startedAt = performance.now();

  const response = await dependencyFetch.fetch(
    "https://example.test/auth/v1/user",
  );
  const body = await response.json() as { code: string };
  const elapsedMs = performance.now() - startedAt;

  assert.equal(response.status, 408);
  assert.equal(body.code, SERVER_AUTH_TIMEOUT_CODE);
  assert.equal(dependencyFetch.shouldPreserveSession(), true);
  assert.ok(elapsedMs >= timeoutMs - 5);
  assert.ok(elapsedMs < 250, `server Auth took ${elapsedMs}ms`);
});

test("Auth network and upstream failures remain retryable", async (t) => {
  await t.test("network failure", async () => {
    const dependencyFetch = createSupabaseServerFetch({
      fetchImpl: async () => {
        throw new TypeError("network unavailable");
      },
    });
    const response = await dependencyFetch.fetch(
      "https://example.test/auth/v1/token",
    );
    const body = await response.json() as { code: string };

    assert.equal(response.status, 409);
    assert.equal(body.code, SERVER_AUTH_UNAVAILABLE_CODE);
    assert.equal(dependencyFetch.shouldPreserveSession(), true);
    assert.equal(isServerAuthUnavailable({ status: 409, code: body.code }), true);
  });

  await t.test("upstream failure", async () => {
    const dependencyFetch = createSupabaseServerFetch({
      fetchImpl: async () => Response.json(
        { code: "unexpected_failure" },
        { status: 503 },
      ),
    });
    const response = await dependencyFetch.fetch(
      "https://example.test/auth/v1/user",
    );
    const body = await response.json() as { code: string };

    assert.equal(response.status, 409);
    assert.equal(body.code, SERVER_AUTH_UNAVAILABLE_CODE);
    assert.equal(dependencyFetch.shouldPreserveSession(), true);
  });
});

test("a hanging database request is bounded without masquerading as missing data", async () => {
  const timeoutMs = 20;
  const dependencyFetch = createSupabaseServerFetch({
    databaseTimeoutMs: timeoutMs,
    fetchImpl: async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      }),
  });

  const response = await dependencyFetch.fetch(
    "https://example.test/rest/v1/profiles",
  );
  const body = await response.json() as { code: string };

  assert.equal(response.status, 504);
  assert.equal(body.code, SERVER_DATABASE_TIMEOUT_CODE);
  assert.equal(dependencyFetch.shouldPreserveSession(), false);
});

test("controlled service-unavailable responses are retryable and never cached", async () => {
  const response = serviceUnavailableResponse();
  const body = await response.json() as { error: string; retryable: boolean };

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("retry-after"), "5");
  assert.equal(body.retryable, true);
  assert.match(body.error, /try again/i);
});
