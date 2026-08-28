export const MIDDLEWARE_AUTH_TIMEOUT_MS = 7_000;
export const MIDDLEWARE_AUTH_TIMEOUT_CODE = "pick8_auth_timeout";
export const MIDDLEWARE_AUTH_UNAVAILABLE_CODE = "pick8_auth_unavailable";
export const MIDDLEWARE_AUTH_UNAVAILABLE_RESPONSE = {
  body: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Pick8 is temporarily unavailable</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #07111f; color: #f8fafc; font-family: system-ui, sans-serif; }
      main { box-sizing: border-box; width: min(92vw, 32rem); padding: 2rem; border: 1px solid #334155; border-radius: 1rem; background: #0f1d30; text-align: center; }
      h1 { margin: 0 0 .75rem; font-size: 1.75rem; }
      p { margin: 0; color: #cbd5e1; line-height: 1.6; }
      a { display: block; margin-top: 1.5rem; padding: .8rem 1rem; border-radius: .75rem; background: #f8fafc; color: #07111f; font-weight: 800; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>Pick8 couldn&rsquo;t verify your session</h1>
      <p>Your session and picks have not been cleared. The connection problem is usually temporary.</p>
      <a href="">Try again</a>
    </main>
  </body>
</html>`,
  status: 503,
  headers: {
    "Cache-Control": "private, no-store",
    "Content-Type": "text/html; charset=utf-8",
    "Retry-After": "5",
  },
} as const;

const INVALID_AUTH_CODES = new Set([
  "bad_jwt",
  "invalid_jwt",
  "refresh_token_already_used",
  "refresh_token_not_found",
  "session_not_found",
  "user_not_found",
]);

const PROTECTED_PREFIXES = [
  "/admin",
  "/dashboard",
  "/leaderboard",
  "/league",
  "/leagues",
  "/pick-fixtures",
  "/predictions",
  "/my-picks",
  "/rules",
  "/settings",
  "/tables",
] as const;

type AuthErrorLike = {
  name?: string;
  status?: number;
  code?: string;
};

export type MiddlewareAuthResult = {
  user: { id: string } | null;
  error: AuthErrorLike | null;
};

export type MiddlewareAuthDecision =
  | { kind: "public" }
  | { kind: "allow"; userId: string }
  | { kind: "redirect"; error: AuthErrorLike | null }
  | { kind: "unavailable"; error: AuthErrorLike | null; timedOut: boolean };

export function isProtectedPick8Route(pathname: string) {
  return PROTECTED_PREFIXES.some(
    (prefix) =>
      pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isMiddlewareAuthTimeout(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as AuthErrorLike;
  return candidate.status === 408 &&
    candidate.code === MIDDLEWARE_AUTH_TIMEOUT_CODE;
}

export function isInvalidMiddlewareAuthentication(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as AuthErrorLike;
  return candidate.name === "AuthSessionMissingError" ||
    candidate.status === 401 ||
    candidate.status === 403 ||
    (typeof candidate.code === "string" &&
      INVALID_AUTH_CODES.has(candidate.code));
}

export async function evaluateMiddlewareAuth(
  pathname: string,
  authenticate: () => Promise<MiddlewareAuthResult>,
): Promise<MiddlewareAuthDecision> {
  if (!isProtectedPick8Route(pathname)) return { kind: "public" };

  const { user, error } = await authenticate();
  if (isMiddlewareAuthTimeout(error)) {
    return { kind: "unavailable", error, timedOut: true };
  }
  if (error) {
    return isInvalidMiddlewareAuthentication(error)
      ? { kind: "redirect", error }
      : { kind: "unavailable", error, timedOut: false };
  }
  return user
    ? { kind: "allow", userId: user.id }
    : { kind: "redirect", error: null };
}

export function createMiddlewareAuthFetch({
  fetchImpl = globalThis.fetch,
  timeoutMs = MIDDLEWARE_AUTH_TIMEOUT_MS,
}: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}) {
  let timedOut = false;
  let preserveSession = false;

  const timedFetch: typeof fetch = async (input, init) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;

    try {
      const response = await fetchImpl(input, { ...init, signal });
      const body = await response.arrayBuffer();

      if (response.status === 429 || response.status >= 500) {
        preserveSession = true;
        return new Response(
          JSON.stringify({
            code: MIDDLEWARE_AUTH_UNAVAILABLE_CODE,
            message: "Supabase Auth is temporarily unavailable.",
          }),
          {
            status: 409,
            headers: {
              "Content-Type": "application/json",
              "X-Supabase-Api-Version": "2024-01-01",
            },
          },
        );
      }

      return new Response(body.byteLength ? body : null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      timedOut = timeoutSignal.aborted;
      preserveSession = true;

      // A synthetic non-retryable response stops auth-js from extending one
      // failed request into its retry window. The middleware cookie bridge
      // separately suppresses session removal for transient failures.
      return new Response(
        JSON.stringify({
          code: timedOut
            ? MIDDLEWARE_AUTH_TIMEOUT_CODE
            : MIDDLEWARE_AUTH_UNAVAILABLE_CODE,
          message: timedOut
            ? "Supabase Auth request timed out."
            : "Supabase Auth could not be reached.",
        }),
        {
          status: timedOut ? 408 : 409,
          headers: {
            "Content-Type": "application/json",
            "X-Supabase-Api-Version": "2024-01-01",
          },
        },
      );
    }
  };

  return {
    fetch: timedFetch,
    didTimeout: () => timedOut,
    shouldPreserveSession: () => preserveSession,
  };
}

export function shouldApplyMiddlewareAuthCookies(preserveSession: boolean) {
  return !preserveSession;
}
