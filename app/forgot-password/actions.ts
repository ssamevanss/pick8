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
      error: "Password reset is not configured yet. Ask the Pick8 administrator to check setup.",
    });
  }

  let redirectUrl: URL;
  try {
    redirectUrl = new URL("/auth/callback", siteUrl);
  } catch {
    redirectWithEmail("/forgot-password", email, {
      error: "Password reset is not configured yet. Ask the Pick8 administrator to check setup.",
    });
  }
  redirectUrl.searchParams.set("next", "/reset-password");

  const supabase = await createClient();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectUrl.toString(),
  });

  if (error) {
    console.error("Pick8 password reset request failed", {
      code: error.code,
      message: error.message,
    });
    redirectWithEmail("/forgot-password", email, {
      error: "We could not send the reset email. Please wait a moment and try again.",
    });
  }

  redirectWithEmail("/forgot-password", email, {
    sent: "1",
  });
}
