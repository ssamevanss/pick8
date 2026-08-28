import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { logServerTiming, startServerTiming } from "@/utils/server-timing";
import type { Database } from "@/types/database.types";
import {
  createMiddlewareAuthFetch,
  evaluateMiddlewareAuth,
  isProtectedPick8Route,
  MIDDLEWARE_AUTH_TIMEOUT_MS,
  MIDDLEWARE_AUTH_UNAVAILABLE_RESPONSE,
  shouldApplyMiddlewareAuthCookies,
} from "@/utils/supabase/middleware-auth";

function elapsedMs(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function authErrorFields(error: unknown) {
  if (!error || typeof error !== "object") {
    return { errorName: "UnknownError", errorStatus: null, errorCode: null };
  }
  const candidate = error as {
    name?: unknown;
    status?: unknown;
    code?: unknown;
  };
  return {
    errorName: typeof candidate.name === "string" ? candidate.name : "UnknownError",
    errorStatus: typeof candidate.status === "number" ? candidate.status : null,
    errorCode: typeof candidate.code === "string" ? candidate.code : null,
  };
}

function logMiddlewareAuth(
  event: "start" | "success" | "timeout" | "error",
  fields: Record<string, unknown>,
) {
  console.info(JSON.stringify({
    service: "pick8-middleware-auth",
    event,
    ...fields,
  }));
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (!isProtectedPick8Route(pathname)) {
    return NextResponse.next({ request });
  }

  const startedAt = startServerTiming();
  const authStartedAt = performance.now();
  const region = process.env.VERCEL_REGION ?? null;
  const authFetch = createMiddlewareAuthFetch();
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          if (!shouldApplyMiddlewareAuthCookies(authFetch.shouldPreserveSession())) {
            return;
          }
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );

          supabaseResponse = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([name, value]) =>
            supabaseResponse.headers.set(name, value),
          );
        },
      },
      global: {
        fetch: authFetch.fetch,
      },
    },
  );

  logMiddlewareAuth("start", {
    path: pathname,
    region,
    timeoutMs: MIDDLEWARE_AUTH_TIMEOUT_MS,
  });

  let decision;
  try {
    decision = await evaluateMiddlewareAuth(pathname, async () => {
      const { data, error } = await supabase.auth.getUser();
      return { user: data.user, error };
    });
  } catch (error) {
    logMiddlewareAuth("error", {
      path: pathname,
      region,
      elapsedMs: elapsedMs(authStartedAt),
      ...authErrorFields(error),
    });
    return new NextResponse(
      MIDDLEWARE_AUTH_UNAVAILABLE_RESPONSE.body,
      MIDDLEWARE_AUTH_UNAVAILABLE_RESPONSE,
    );
  }

  if (decision.kind === "unavailable") {
    logMiddlewareAuth(decision.timedOut ? "timeout" : "error", {
      path: pathname,
      region,
      elapsedMs: elapsedMs(authStartedAt),
      ...authErrorFields(decision.error),
    });
    return new NextResponse(
      MIDDLEWARE_AUTH_UNAVAILABLE_RESPONSE.body,
      MIDDLEWARE_AUTH_UNAVAILABLE_RESPONSE,
    );
  }

  if (decision.kind === "redirect") {
    logMiddlewareAuth(decision.error ? "error" : "success", {
      path: pathname,
      region,
      elapsedMs: elapsedMs(authStartedAt),
      authenticated: false,
      classification: decision.error ? "invalid" : "missing",
      ...(decision.error ? authErrorFields(decision.error) : {}),
    });
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    const redirectResponse = NextResponse.redirect(loginUrl);

    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });

    logServerTiming("middleware.session", startedAt, {
      path: request.nextUrl.pathname,
      authenticated: false,
      redirected: true,
    });
    return redirectResponse;
  }

  logMiddlewareAuth("success", {
    path: pathname,
    region,
    elapsedMs: elapsedMs(authStartedAt),
    authenticated: true,
  });
  logServerTiming("middleware.session", startedAt, {
    path: pathname,
    authenticated: true,
    redirected: false,
  });
  return supabaseResponse;
}
