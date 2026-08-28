export const SERVER_AUTH_TIMEOUT_MS = 10_000;
export const SERVER_DATABASE_TIMEOUT_MS = 15_000;
export const SERVER_DATABASE_MUTATION_TIMEOUT_MS = 20_000;
export const INTERACTIVE_PAGE_TIMEOUT_MS = 28_000;
export const INTERACTIVE_ACTION_TIMEOUT_MS = 25_000;
export const SERVER_AUTH_TIMEOUT_CODE = "pick8_server_auth_timeout";
export const SERVER_AUTH_UNAVAILABLE_CODE = "pick8_server_auth_unavailable";
export const SERVER_DATABASE_TIMEOUT_CODE = "pick8_database_timeout";
export const SERVER_DATABASE_UNAVAILABLE_CODE = "pick8_database_unavailable";

const INVALID_AUTH_CODES = new Set([
  "bad_jwt",
  "invalid_credentials",
  "invalid_jwt",
  "refresh_token_already_used",
  "refresh_token_not_found",
  "session_not_found",
  "user_not_found",
]);

type ErrorLike = {
  name?: string;
  status?: number;
  code?: string;
};

type AuthResultLike = {
  user: { id: string } | null;
  error: ErrorLike | null;
};

export type SupabaseResilienceContext = {
  page?: string;
  action?: string;
  operation?: string;
  requestId?: string | null;
};

export type ServerAuthState =
  | { kind: "authenticated"; user: { id: string } }
  | { kind: "unauthenticated"; error: ErrorLike | null }
  | { kind: "unavailable"; error: ErrorLike };

export class Pick8ServiceUnavailableError extends Error {
  readonly code = "PICK8_SERVICE_UNAVAILABLE";
  readonly dependency: "auth" | "database";

  constructor(dependency: "auth" | "database") {
    super("A required Pick8 service is temporarily unavailable.");
    this.name = "Pick8ServiceUnavailableError";
    this.dependency = dependency;
  }
}

function errorFields(error: unknown) {
  if (!error || typeof error !== "object") {
    return { errorName: "UnknownError", errorStatus: null, errorCode: null };
  }
  const candidate = error as ErrorLike;
  return {
    errorName: candidate.name ?? "UnknownError",
    errorStatus: candidate.status ?? null,
    errorCode: candidate.code ?? null,
  };
}

function logDependencyEvent(
  event: "timeout" | "error",
  fields: Record<string, unknown>,
) {
  console.error(JSON.stringify({
    service: "pick8-supabase",
    event,
    region: process.env.VERCEL_REGION ?? null,
    ...fields,
  }));
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase();
  return typeof Request !== "undefined" && input instanceof Request
    ? input.method.toUpperCase()
    : "GET";
}

function dependencyOperation(
  input: RequestInfo | URL,
  auth: boolean,
  configured?: string,
) {
  if (configured) return configured;
  if (auth) return "auth";

  const value = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  try {
    const segments = new URL(value).pathname.split("/").filter(Boolean);
    const restIndex = segments.indexOf("v1");
    return restIndex >= 0
      ? segments.slice(restIndex + 1, restIndex + 3).join(".") || "database"
      : "database";
  } catch {
    return "database";
  }
}

function isAuthUrl(input: RequestInfo | URL) {
  const value = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  try {
    return new URL(value).pathname.includes("/auth/v1/");
  } catch {
    return value.includes("/auth/v1/");
  }
}

function jsonResponse(
  code: string,
  message: string,
  status: number,
  auth: boolean,
) {
  return new Response(
    JSON.stringify({ code, message, details: null, hint: null }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { "X-Supabase-Api-Version": "2024-01-01" } : {}),
      },
    },
  );
}

export function isInvalidServerAuthentication(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as ErrorLike;
  return candidate.name === "AuthSessionMissingError" ||
    candidate.status === 401 ||
    candidate.status === 403 ||
    (typeof candidate.code === "string" && INVALID_AUTH_CODES.has(candidate.code));
}

export function isServerAuthUnavailable(error: unknown) {
  if (!error || typeof error !== "object" || isInvalidServerAuthentication(error)) {
    return false;
  }

  const candidate = error as ErrorLike;
  return candidate.code === SERVER_AUTH_TIMEOUT_CODE ||
    candidate.code === SERVER_AUTH_UNAVAILABLE_CODE ||
    candidate.name === "AuthRetryableFetchError" ||
    candidate.name === "AuthUnknownError" ||
    candidate.status === 408 ||
    candidate.status === 429 ||
    (typeof candidate.status === "number" && candidate.status >= 500);
}

export function isTransientDatabaseError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as ErrorLike;
  return candidate.code === SERVER_DATABASE_TIMEOUT_CODE ||
    candidate.code === SERVER_DATABASE_UNAVAILABLE_CODE ||
    candidate.status === 408 ||
    candidate.status === 429 ||
    (typeof candidate.status === "number" && candidate.status >= 500);
}

export function isDatabaseTimeoutError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as ErrorLike;
  return candidate.code === SERVER_DATABASE_TIMEOUT_CODE ||
    candidate.status === 408 || candidate.status === 504;
}

export function requireSuccessfulDatabaseOperation(error: unknown) {
  if (error) throw new Pick8ServiceUnavailableError("database");
}

export function classifyServerAuth({
  user,
  error,
}: AuthResultLike): ServerAuthState {
  if (error) {
    return isInvalidServerAuthentication(error)
      ? { kind: "unauthenticated", error }
      : { kind: "unavailable", error };
  }

  return user
    ? { kind: "authenticated", user }
    : { kind: "unauthenticated", error: null };
}

export function createSupabaseServerFetch({
  fetchImpl = globalThis.fetch,
  authTimeoutMs = SERVER_AUTH_TIMEOUT_MS,
  databaseTimeoutMs = SERVER_DATABASE_TIMEOUT_MS,
  databaseReadTimeoutMs = databaseTimeoutMs,
  databaseMutationTimeoutMs = SERVER_DATABASE_MUTATION_TIMEOUT_MS,
  overallSignal,
  context = {},
}: {
  fetchImpl?: typeof fetch;
  authTimeoutMs?: number;
  databaseTimeoutMs?: number;
  databaseReadTimeoutMs?: number;
  databaseMutationTimeoutMs?: number;
  overallSignal?: AbortSignal;
  context?: SupabaseResilienceContext;
} = {}) {
  let preserveSession = false;

  const resilientFetch: typeof fetch = async (input, init) => {
    const auth = isAuthUrl(input);
    const dependency = auth ? "auth" : "database";
    const method = requestMethod(input, init);
    const mutation = !["GET", "HEAD"].includes(method);
    const timeoutMs = auth
      ? authTimeoutMs
      : mutation
        ? databaseMutationTimeoutMs
        : databaseReadTimeoutMs;
    const startedAt = performance.now();
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signals = [timeoutSignal, init?.signal, overallSignal].filter(
      (signal): signal is AbortSignal => Boolean(signal),
    );
    const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    const logContext = {
      ...context,
      operation: dependencyOperation(input, auth, context.operation),
    };

    try {
      const response = await fetchImpl(input, { ...init, signal });

      if (!auth) {
        if (response.status === 429 || response.status >= 500) {
          logDependencyEvent("error", {
            ...logContext,
            dependency,
            elapsedMs: Math.round(performance.now() - startedAt),
            timeoutMs,
            upstreamStatus: response.status,
          });
          return jsonResponse(
            SERVER_DATABASE_UNAVAILABLE_CODE,
            "Supabase Database is temporarily unavailable.",
            503,
            false,
          );
        }
        return response;
      }

      // Buffer the small Auth response while the deadline is still active so
      // a stalled response body cannot outlive the fetch timeout.
      const body = await response.arrayBuffer();

      if (response.status === 429 || response.status >= 500) {
        preserveSession = true;
        logDependencyEvent("error", {
          ...logContext,
          dependency,
          elapsedMs: Math.round(performance.now() - startedAt),
          timeoutMs,
          upstreamStatus: response.status,
        });
        return jsonResponse(
          SERVER_AUTH_UNAVAILABLE_CODE,
          "Supabase Auth is temporarily unavailable.",
          409,
          true,
        );
      }

      return new Response(body.byteLength ? body : null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      const operationTimedOut = timeoutSignal.aborted;
      const overallTimedOut = Boolean(overallSignal?.aborted);
      const timedOut = operationTimedOut || overallTimedOut;
      const deadlineSource = overallTimedOut ? "overall" : operationTimedOut
        ? "operation"
        : null;

      if (auth) {
        preserveSession = true;
        logDependencyEvent(timedOut ? "timeout" : "error", {
          ...logContext,
          dependency,
          elapsedMs: Math.round(performance.now() - startedAt),
          timeoutMs,
          deadlineSource,
          ...errorFields(error),
        });
        return jsonResponse(
          timedOut ? SERVER_AUTH_TIMEOUT_CODE : SERVER_AUTH_UNAVAILABLE_CODE,
          timedOut
            ? `Supabase Auth did not respond within ${timeoutMs}ms.`
            : "Supabase Auth could not be reached.",
          timedOut ? 408 : 409,
          true,
        );
      }

      logDependencyEvent(timedOut ? "timeout" : "error", {
        ...logContext,
        dependency,
        elapsedMs: Math.round(performance.now() - startedAt),
        timeoutMs,
        deadlineSource,
        ...errorFields(error),
      });
      return jsonResponse(
        timedOut
          ? SERVER_DATABASE_TIMEOUT_CODE
          : SERVER_DATABASE_UNAVAILABLE_CODE,
        timedOut
          ? `Supabase Database did not respond within ${timeoutMs}ms.`
          : "Supabase Database could not be reached.",
        timedOut ? 504 : 503,
        false,
      );
    }
  };

  return {
    fetch: resilientFetch,
    shouldPreserveSession: () => preserveSession,
  };
}

export function serviceUnavailableResponse() {
  return Response.json(
    {
      error: "Pick8 is temporarily unable to verify your account. Please try again.",
      retryable: true,
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": "5",
      },
    },
  );
}
