import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { SELECTED_LEAGUE_COOKIE } from "@/utils/leagues";
import { getLeagueLaunchDecision } from "@/utils/league-launch";

function redirectWithoutCaching(request: NextRequest, destination: string) {
  const response = NextResponse.redirect(
    new URL(destination, request.url),
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectWithoutCaching(request, "/login");
  }

  const decision = await getLeagueLaunchDecision(supabase, user.id);
  const response = redirectWithoutCaching(request, decision.destination);

  if (decision.selectedLeagueId) {
    response.cookies.set(
      SELECTED_LEAGUE_COOKIE,
      decision.selectedLeagueId,
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      },
    );
  } else {
    response.cookies.delete(SELECTED_LEAGUE_COOKIE);
  }

  return response;
}
