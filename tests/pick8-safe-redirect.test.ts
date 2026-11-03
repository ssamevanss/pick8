import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleAuthCallback } from "../utils/pick8-auth-callback.ts";
import {
  safeOptionalRedirectPath,
  safeRedirectPath,
} from "../utils/pick8-safe-redirect.ts";

const ORIGIN = "https://pick8pl.vercel.app";

// Inputs a browser would resolve off-origin, or that a lax startsWith("/") check would let through.
const HOSTILE = [
  "https://evil.example/",
  "http://evil.example",
  "//evil.example",
  "///evil.example",
  "////evil.example/path",
  "/\\evil.example",
  "/\\/evil.example",
  "\\\\evil.example",
  "\\/evil.example",
  "/\t/evil.example",
  "/\n/evil.example",
  "/\r/evil.example",
  "/\r\n/evil.example",
  "/\u0000/evil.example",
  "/ /evil.example",
  "/ /evil.example",
  "/ /evil.example",
  " //evil.example",
  "\t//evil.example",
  "/%5Cevil.example",
  "/%5cevil.example",
  "/%2F%2Fevil.example",
  "/%2f/evil.example",
  "/%09/evil.example",
  "/%0a/evil.example",
  "/%0D%0A/evil.example",
  "/%255Cevil.example",
  "/%252F%252Fevil.example",
  "/%25255Cevil.example",
  "/.//evil.example",
  "/./\\evil.example",
  "/foo/..//evil.example",
  "/%E0%A4%A",
  "javascript:alert(1)",
  "/javascript:alert(1)\\@evil.example",
  "data:text/html,x",
  "evil.example",
  "dashboard",
  "?next=/dashboard",
  "#//evil.example",
  "",
  "/" + "a".repeat(2100),
];

test("hostile redirect targets all fall back to the default", () => {
  for (const input of HOSTILE) {
    assert.equal(safeRedirectPath(input), "/dashboard", JSON.stringify(input));
    assert.equal(safeOptionalRedirectPath(input), "", JSON.stringify(input));
  }
});

test("non-string input falls back", () => {
  for (const input of [null, undefined, 42, {}, ["/dashboard"], new File([], "x")]) {
    assert.equal(safeRedirectPath(input), "/dashboard");
    assert.equal(safeOptionalRedirectPath(input), "");
  }
});

test("whatever the helper returns resolves to the same origin, exactly as a browser follows it", () => {
  for (const input of HOSTILE) {
    const target = safeRedirectPath(input);
    assert.equal(new URL(target, ORIGIN).origin, ORIGIN, JSON.stringify(input));
    assert.equal(
      new URL(Response.redirect(new URL(target, ORIGIN), 307).headers.get("location")!).origin,
      ORIGIN,
    );
  }
});

test("legitimate same-origin destinations are preserved", () => {
  const legit = [
    "/dashboard",
    "/my-picks",
    "/my-picks?matchday=12",
    "/tables?competition=3&view=season",
    "/rules#scoring",
    "/admin/matchdays/abc-123",
    "/reset-password",
    "/dashboard?note=a%20b",
    "/",
  ];
  for (const input of legit) {
    assert.equal(safeRedirectPath(input), input, input);
    assert.equal(safeOptionalRedirectPath(input), input, input);
  }
});

test("dot segments inside a valid path are normalised", () => {
  assert.equal(safeRedirectPath("/tables/../my-picks"), "/my-picks");
});

test("a custom fallback is returned untouched", () => {
  assert.equal(safeRedirectPath("//evil.example", "/login"), "/login");
});

const callbackUrl = (params: Record<string, string>) => {
  const url = new URL("/auth/callback", ORIGIN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url);
};
const okDeps = {
  exchangeCodeForSession: async () => ({ error: null }),
  isServiceUnavailable: () => false,
};
const locationOf = (response: Response) => response.headers.get("location")!;

test("/auth/callback never redirects off-origin, whatever `next` says", async () => {
  for (const next of HOSTILE) {
    const response = await handleAuthCallback(callbackUrl({ code: "mock-code", next }), okDeps);
    assert.equal(response.status, 307);
    assert.equal(locationOf(response), `${ORIGIN}/dashboard`, JSON.stringify(next));
  }
});

test("/auth/callback also stays on-origin for the invalid-code and outage paths", async () => {
  for (const next of HOSTILE) {
    const noCode = await handleAuthCallback(callbackUrl({ next }), okDeps);
    assert.equal(new URL(locationOf(noCode)).origin, ORIGIN);
    const failed = await handleAuthCallback(callbackUrl({ code: "bad", next }), {
      exchangeCodeForSession: async () => ({ error: new Error("bad") }),
      isServiceUnavailable: () => false,
    });
    assert.equal(new URL(locationOf(failed)).origin, ORIGIN);
    const outage = await handleAuthCallback(callbackUrl({ code: "x", next }), {
      exchangeCodeForSession: async () => ({ error: new Error("down") }),
      isServiceUnavailable: () => true,
    });
    assert.equal(new URL(locationOf(outage)).origin, ORIGIN);
  }
});

test("/auth/callback preserves legitimate post-login destinations", async () => {
  const response = await handleAuthCallback(
    callbackUrl({ code: "mock-code", next: "/my-picks?matchday=12" }),
    okDeps,
  );
  assert.equal(locationOf(response), `${ORIGIN}/my-picks?matchday=12`);

  const defaulted = await handleAuthCallback(callbackUrl({ code: "mock-code" }), okDeps);
  assert.equal(locationOf(defaulted), `${ORIGIN}/dashboard`);
});

test("/auth/callback keeps the password reset flow intact", async () => {
  const reset = await handleAuthCallback(
    callbackUrl({ code: "mock-code", next: "/reset-password" }),
    okDeps,
  );
  assert.equal(locationOf(reset), `${ORIGIN}/reset-password`);

  const expired = await handleAuthCallback(
    callbackUrl({ code: "stale", next: "/reset-password" }),
    { exchangeCodeForSession: async () => ({ error: new Error("expired") }), isServiceUnavailable: () => false },
  );
  assert.match(locationOf(expired), /^https:\/\/pick8pl\.vercel\.app\/reset-password\?error=/);

  const outage = await handleAuthCallback(
    callbackUrl({ code: "x", next: "/reset-password" }),
    { exchangeCodeForSession: async () => ({ error: new Error("down") }), isServiceUnavailable: () => true },
  );
  assert.match(decodeURIComponent(locationOf(outage)), /\/reset-password\?error=The password service is temporarily unavailable/);

  const missingCode = await handleAuthCallback(callbackUrl({ next: "/reset-password" }), okDeps);
  assert.match(locationOf(missingCode), /\/reset-password\?error=/);
});

test("/auth/callback does not call Supabase without a code", async () => {
  let called = false;
  await handleAuthCallback(callbackUrl({ next: "/dashboard" }), {
    exchangeCodeForSession: async () => {
      called = true;
      return { error: null };
    },
    isServiceUnavailable: () => false,
  });
  assert.equal(called, false);
});

// Guards against reintroducing an ad-hoc `startsWith("/")` check in an auth flow.
test("every consumer of a `next` destination uses the shared helper", () => {
  const consumers: Array<[string, RegExp]> = [
    ["../utils/pick8-auth-callback.ts", /safeRedirectPath/],
    ["../app/login/actions.ts", /safeOptionalRedirectPath[\s\S]*safeRedirectPath\(next\)/],
    ["../app/login/page.tsx", /safeOptionalRedirectPath\(params\.next\)/],
    ["../utils/supabase/middleware.ts", /safeOptionalRedirectPath/],
  ];
  for (const [file, pattern] of consumers) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, pattern, file);
    assert.doesNotMatch(source, /startsWith\("\/"\)/, `${file} has an ad-hoc path check`);
  }
});
