import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") ?? "/dashboard";
  const safeNext =
    next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/dashboard";
  const errorPath = safeNext === "/reset-password"
    ? "/reset-password?error=That password reset link is invalid or expired. Request a new one."
    : "/login?error=That sign-in link is invalid or expired.";

  if (!code) {
    return NextResponse.redirect(
      new URL(errorPath, requestUrl.origin),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(errorPath, requestUrl.origin),
    );
  }

  return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
}
