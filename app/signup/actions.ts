"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

export async function signup(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const leagueCode = String(formData.get("league_code") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  const expectedLeagueCode = process.env.LEAGUE_SIGNUP_CODE;

  if (!expectedLeagueCode) {
    redirect("/signup?error=League signup code is not configured");
  }

  if (!email || !displayName || !leagueCode || !password || !confirmPassword) {
    redirect("/signup?error=Complete all fields");
  }

  if (leagueCode !== expectedLeagueCode) {
    redirect("/signup?error=Invalid league code");
  }

  if (password !== confirmPassword) {
    redirect("/signup?error=Passwords do not match");
  }

  if (password.length < 6) {
    redirect("/signup?error=Password must be at least 6 characters");
  }

  const adminSupabase = createAdminClient();

  const { data: existingProfile } = await adminSupabase
    .from("profiles")
    .select("id, status")
    .eq("email", email)
    .maybeSingle();

  if (existingProfile?.status === "approved") {
    redirect("/signup?error=An approved account already exists for this email");
  }

  if (existingProfile?.status === "pending") {
    redirect("/signup?error=This account is already pending approval");
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
    redirect(
      `/signup?error=${encodeURIComponent(
        createUserError?.message ?? "Could not create user",
      )}`,
    );
  }

  const { error: profileError } = await adminSupabase.from("profiles").upsert(
    {
      id: createdUser.user.id,
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
    redirect(`/signup?error=${encodeURIComponent(profileError.message)}`);
  }

  const supabase = await createClient();

  await supabase.auth.signInWithPassword({
    email,
    password,
  });

  redirect("/pending");
}