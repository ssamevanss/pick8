import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  requireLeagueMembership,
  SELECTED_LEAGUE_COOKIE,
} from "@/utils/leagues";
import {
  logServerTiming,
  startServerTiming,
  withServerTiming,
} from "@/utils/server-timing";

function safeDestination(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//")
    ? value
    : "/dashboard";
}

export async function GET(request: NextRequest) {
  const routeStartedAt = startServerTiming();
  const leagueId = request.nextUrl.searchParams.get("league");
  const destination = safeDestination(request.nextUrl.searchParams.get("next"));
  const supabase = await createClient();
  const {
    data: { user },
  } = await withServerTiming(
    "leagues.select.auth",
    () => supabase.auth.getUser(),
    { path: request.nextUrl.pathname },
  );

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (!leagueId) {
    return NextResponse.redirect(new URL("/leagues", request.url));
  }

  try {
    await withServerTiming(
      "leagues.select.membership",
      () => requireLeagueMembership(supabase, user.id, leagueId),
      { path: request.nextUrl.pathname, userId: user.id, leagueId },
    );
  } catch {
    return NextResponse.redirect(
      new URL("/leagues?error=Membership+required", request.url),
    );
  }

  const response = NextResponse.redirect(new URL(destination, request.url));
  response.cookies.set(SELECTED_LEAGUE_COOKIE, leagueId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  logServerTiming("leagues.select.total", routeStartedAt, {
    path: request.nextUrl.pathname,
    userId: user.id,
    leagueId,
  });

  return response;
}
