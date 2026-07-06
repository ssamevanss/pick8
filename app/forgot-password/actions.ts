"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

function redirectWithEmail(
  path: string,
  email: string,
  params: Record<string, string>,
): never {
  const searchParams = new URLSearchParams(params);

  if (email) {
    searchParams.set("email", email);
  }

  redirect(`${path}?${searchParams.toString()}`);
}

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    redirectWithEmail("/forgot-password", email, {
      error: "Enter the email address for your account.",
    });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (!siteUrl) {
    redirectWithEmail("/forgot-password", email, {
      error: "Password reset is not configured yet. Ask the league admin to check setup.",
    });
  }

  const redirectUrl = new URL("/auth/callback", siteUrl);
  redirectUrl.searchParams.set("next", "/reset-password");

  const supabase = await createClient();

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectUrl.toString(),
  });

  redirectWithEmail("/forgot-password", email, {
    sent: "1",
  });
}
