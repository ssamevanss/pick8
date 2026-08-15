import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { logServerTiming, startServerTiming } from "@/utils/server-timing";
import type { Database } from "@/types/database.types";

export async function updateSession(request: NextRequest) {
  const startedAt = startServerTiming();
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
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );

          supabaseResponse = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const protectedPrefixes = [
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
  ];
  const isProtectedRoute = protectedPrefixes.some(
    (prefix) =>
      request.nextUrl.pathname === prefix ||
      request.nextUrl.pathname.startsWith(`${prefix}/`),
  );

  if (!user && isProtectedRoute) {
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

  logServerTiming("middleware.session", startedAt, {
    path: request.nextUrl.pathname,
    authenticated: Boolean(user),
    redirected: false,
  });
  return supabaseResponse;
}
