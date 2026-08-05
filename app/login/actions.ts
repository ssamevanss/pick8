"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

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

  const user = data.user;

  if (!user) {
    redirectWithLoginError(
      "We could not complete your sign in.",
      email,
      next,
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    await supabase.auth.signOut();
    redirectWithLoginError(
      "Your Pick8 profile is not configured. Ask the administrator for help.",
      email,
      next,
    );
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    redirectWithLoginError(
      "Your Pick8 account is inactive. Ask the administrator for help.",
      email,
      next,
    );
  }

  redirect(next || "/dashboard");
}
