"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

function redirectWithLoginError(message: string, email: string): never {
  const params = new URLSearchParams({
    error: message,
  });

  if (email) {
    params.set("email", email);
  }

  redirect(`/login?${params.toString()}`);
}

export async function login(formData: FormData) {
  const supabase = await createClient();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password"));

  if (!email || !password) {
    redirectWithLoginError("Enter your email and password.", email);
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirectWithLoginError(
      "We could not sign you in with those details.",
      email,
    );
  }

  redirect("/dashboard");
}
