"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (!password || !confirmPassword) {
    redirect("/reset-password?error=Enter and confirm your new password.");
  }

  if (password !== confirmPassword) {
    redirect("/reset-password?error=The passwords do not match.");
  }

  if (password.length < 6) {
    redirect(
      "/reset-password?error=Your password needs to be at least 6 characters.",
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    redirect(
      "/reset-password?error=We could not update your password. Open the latest reset link and try again.",
    );
  }

  redirect("/reset-password?updated=1");
}
