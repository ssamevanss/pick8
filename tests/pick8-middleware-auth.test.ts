import test from "node:test";
import assert from "node:assert/strict";
import {
  createMiddlewareAuthFetch,
  evaluateMiddlewareAuth,
  MIDDLEWARE_AUTH_TIMEOUT_CODE,
  MIDDLEWARE_AUTH_UNAVAILABLE_RESPONSE,
  shouldApplyMiddlewareAuthCookies,
} from "../utils/supabase/middleware-auth.ts";

test("an authenticated protected request is allowed", async () => {
  const decision = await evaluateMiddlewareAuth("/tables", async () => ({
    user: { id: "player" },
    error: null,
  }));

  assert.deepEqual(decision, { kind: "allow", userId: "player" });
});

test("an unauthenticated protected request redirects to login", async () => {
  const error = {
    name: "AuthSessionMissingError",
    status: 400,
  };
  const decision = await evaluateMiddlewareAuth("/my-picks", async () => ({
    user: null,
    error,
  }));

  assert.deepEqual(decision, { kind: "redirect", error });
});

test("public login bypasses authentication even when the auth operation never resolves", async () => {
  let authCalled = false;
  const decision = await evaluateMiddlewareAuth("/login", async () => {
    authCalled = true;
    return await new Promise(() => {});
  });

  assert.deepEqual(decision, { kind: "public" });
  assert.equal(authCalled, false);
});

test("a hanging protected-route auth fetch becomes a controlled unavailable result", async () => {
  const timeoutMs = 20;
  const authFetch = createMiddlewareAuthFetch({
    timeoutMs,
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

  const decision = await evaluateMiddlewareAuth("/tables", async () => {
    const response = await authFetch.fetch("https://example.test/auth/v1/user");
    const body = await response.json() as { code: string };
    return {
      user: null,
      error: {
        name: "AuthApiError",
        status: response.status,
        code: body.code,
      },
    };
  });
  const elapsedMs = performance.now() - startedAt;

  assert.equal(decision.kind, "unavailable");
  assert.equal(decision.kind === "unavailable" && decision.timedOut, true);
  assert.equal(MIDDLEWARE_AUTH_UNAVAILABLE_RESPONSE.status, 503);
  assert.equal(
    MIDDLEWARE_AUTH_UNAVAILABLE_RESPONSE.headers["Cache-Control"],
    "private, no-store",
  );
  assert.match(MIDDLEWARE_AUTH_UNAVAILABLE_RESPONSE.body, /Try again/);
  assert.equal(authFetch.didTimeout(), true);
  assert.ok(elapsedMs >= timeoutMs - 5);
  assert.ok(elapsedMs < 250, `middleware auth took ${elapsedMs}ms`);
});

test("middleware timeout marker is stable and timeout never applies session cookie changes", async () => {
  const authFetch = createMiddlewareAuthFetch({
    timeoutMs: 10,
    fetchImpl: async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true,
        });
      }),
  });

  const response = await authFetch.fetch("https://example.test/auth/v1/token");
  const body = await response.json() as { code: string };

  assert.equal(body.code, MIDDLEWARE_AUTH_TIMEOUT_CODE);
  assert.equal(response.status, 408);
  assert.equal(shouldApplyMiddlewareAuthCookies(authFetch.didTimeout()), false);
});

test("non-timeout auth failures are not misclassified as invalid sessions", async () => {
  const error = { name: "AuthApiError", status: 500, code: "unexpected_failure" };
  const decision = await evaluateMiddlewareAuth("/tables", async () => ({
    user: null,
    error,
  }));

  assert.deepEqual(decision, {
    kind: "unavailable",
    error,
    timedOut: false,
  });
  assert.equal(shouldApplyMiddlewareAuthCookies(false), true);
});

test("network auth failures remain bounded and preserve session cookies", async () => {
  const authFetch = createMiddlewareAuthFetch({
    fetchImpl: async () => {
      throw new TypeError("network unavailable");
    },
  });

  const response = await authFetch.fetch("https://example.test/auth/v1/user");
  const body = await response.json() as { code: string };

  assert.equal(response.status, 409);
  assert.equal(body.code, "pick8_auth_unavailable");
  assert.equal(authFetch.didTimeout(), false);
  assert.equal(authFetch.shouldPreserveSession(), true);
  assert.equal(
    shouldApplyMiddlewareAuthCookies(authFetch.shouldPreserveSession()),
    false,
  );
});

test("upstream auth outages do not clear session cookies", async () => {
  const authFetch = createMiddlewareAuthFetch({
    fetchImpl: async () => Response.json(
      { code: "unexpected_failure", message: "unavailable" },
      { status: 503 },
    ),
  });

  const response = await authFetch.fetch("https://example.test/auth/v1/user");

  assert.equal(response.status, 409);
  assert.equal(authFetch.shouldPreserveSession(), true);
  assert.equal(
    shouldApplyMiddlewareAuthCookies(authFetch.shouldPreserveSession()),
    false,
  );
});
