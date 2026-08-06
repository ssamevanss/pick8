"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

function returnToSignup(message: string, displayName: string, email: string): never {
  const params = new URLSearchParams({ error: message });
  if (displayName) params.set("display_name", displayName);
  if (email) params.set("email", email);
  redirect(`/signup?${params.toString()}`);
}

export async function signup(formData: FormData) {
  const displayName = String(formData.get("display_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirm_password") ?? "");
  const suppliedCode = String(formData.get("registration_code") ?? "");
  const signupCode = process.env.PICK8_SIGNUP_CODE;

  if (!signupCode) returnToSignup("Account creation is not configured. Ask the Pick8 administrator for help.", displayName, email);
  const nonWhitespaceLength = displayName.replaceAll(/\s/g, "").length;
  if (nonWhitespaceLength < 1 || nonWhitespaceLength > 80 || displayName.length > 80) returnToSignup("Display name must contain between 1 and 80 characters.", displayName, email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) returnToSignup("Enter a valid email address.", displayName, email);
  if (password.length < 6) returnToSignup("Your password needs to be at least 6 characters.", displayName, email);
  if (password !== confirmation) returnToSignup("The passwords do not match.", displayName, email);
  if (suppliedCode !== signupCode) returnToSignup("We could not create an account with those details.", displayName, email);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!siteUrl) returnToSignup("Account creation is not configured. Ask the Pick8 administrator for help.", displayName, email);
  let callbackUrl: string;
  try {
    callbackUrl = new URL("/auth/callback", siteUrl).toString();
  } catch {
    returnToSignup("Account creation is not configured. Ask the Pick8 administrator for help.", displayName, email);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName }, emailRedirectTo: callbackUrl },
  });
  if (error) returnToSignup("We could not create an account with those details. Try signing in or resetting your password.", displayName, email);
  if (data.session) redirect("/dashboard");
  if (data.user) redirect("/signup?check_email=1");
  redirect("/login?created=1");
}
