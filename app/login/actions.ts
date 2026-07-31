"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { SELECTED_LEAGUE_COOKIE } from "@/utils/leagues";
import { getLeagueLaunchDecision } from "@/utils/league-launch";

function safeNext(value: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value : "";
}

function redirectWithLoginError(
  message: string,
  email: string,
  next: string,
): never {
  const params = new URLSearchParams({
    error: message,
  });

  if (email) {
    params.set("email", email);
  }
  if (next) {
    params.set("next", next);
  }

  redirect(`/login?${params.toString()}`);
}

export async function login(formData: FormData) {
  const supabase = await createClient();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password"));
  const next = safeNext(String(formData.get("next") ?? ""));

  if (!email || !password) {
    redirectWithLoginError("Enter your email and password.", email, next);
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirectWithLoginError(
      "We could not sign you in with those details.",
      email,
      next,
    );
  }

  // `/leagues/launch` is an internal resolver, not a page the user should
  // land on after a password sign-in. Resolve it here so the first visible
  // authenticated URL is the final destination.
  if (next && next !== "/leagues/launch") {
    redirect(next);
  }

  const user = data.user;

  if (!user) {
    redirectWithLoginError(
      "We could not complete your sign in.",
      email,
      next,
    );
  }

  const decision = await getLeagueLaunchDecision(supabase, user.id);
  const cookieStore = await cookies();

  if (decision.selectedLeagueId) {
    cookieStore.set(SELECTED_LEAGUE_COOKIE, decision.selectedLeagueId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  } else {
    cookieStore.delete(SELECTED_LEAGUE_COOKIE);
  }

  redirect(decision.destination);
}
