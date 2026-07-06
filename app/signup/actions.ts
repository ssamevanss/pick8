"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

function getSignupParams(formData: FormData, error: string) {
  const params = new URLSearchParams({ error });
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const leagueCode = String(formData.get("league_code") ?? "").trim();

  if (email) {
    params.set("email", email);
  }

  if (displayName) {
    params.set("display_name", displayName);
  }

  if (leagueCode) {
    params.set("league_code", leagueCode);
  }

  return params;
}

function redirectWithSignupError(message: string, formData: FormData): never {
  redirect(`/signup?${getSignupParams(formData, message).toString()}`);
}

export async function signup(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const leagueCode = String(formData.get("league_code") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  const expectedLeagueCode = process.env.LEAGUE_SIGNUP_CODE;

  if (!expectedLeagueCode) {
    redirectWithSignupError(
      "Account requests are not configured yet. Ask the league admin to check setup.",
      formData,
    );
  }

  if (!email || !displayName || !leagueCode || !password || !confirmPassword) {
    redirectWithSignupError("Fill in all fields to request access.", formData);
  }

  if (leagueCode !== expectedLeagueCode) {
    redirectWithSignupError(
      "That invite code does not look right. Check it and try again.",
      formData,
    );
  }

  if (password !== confirmPassword) {
    redirectWithSignupError("The passwords do not match.", formData);
  }

  if (password.length < 6) {
    redirectWithSignupError(
      "Your password needs to be at least 6 characters.",
      formData,
    );
  }

  const adminSupabase = createAdminClient();

  const { data: existingProfile } = await adminSupabase
    .from("profiles")
    .select("id, status")
    .eq("email", email)
    .maybeSingle();

  if (existingProfile?.status === "approved") {
    redirectWithSignupError(
      "If you already have an approved account, sign in instead.",
      formData,
    );
  }

  if (existingProfile?.status === "pending") {
    redirectWithSignupError(
      "This account request is already waiting for admin approval.",
      formData,
    );
  }

  const { data: createdUser, error: createUserError } =
    await adminSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
      },
    });

  if (createUserError || !createdUser.user) {
    redirectWithSignupError(
      "We could not create your account right now. Try again or ask the league admin.",
      formData,
    );
  }

  const newUser = createdUser.user;

  const { error: profileError } = await adminSupabase.from("profiles").upsert(
    {
      id: newUser.id,
      email,
      display_name: displayName,
      role: "player",
      status: "pending",
    },
    {
      onConflict: "id",
    },
  );

  if (profileError) {
    redirectWithSignupError(
      "Your account was created, but we could not finish the league request. Ask the league admin to check your profile.",
      formData,
    );
  }

  const supabase = await createClient();

  await supabase.auth.signInWithPassword({
    email,
    password,
  });

  redirect("/pending");
}
