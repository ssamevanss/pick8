// Decision logic for GET /auth/callback, separated from Next/Supabase so the redirect behaviour
// is unit-tested against real Response objects. The route supplies the Supabase-backed dependencies.
import { safeRedirectPath } from "./pick8-safe-redirect.ts";

const RESET_PATH = "/reset-password";

export type AuthCallbackDeps = {
  exchangeCodeForSession: (code: string) => Promise<{ error: unknown }>;
  isServiceUnavailable: (error: unknown) => boolean;
};

export async function handleAuthCallback(
  request: Request,
  deps: AuthCallbackDeps,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const safeNext = safeRedirectPath(requestUrl.searchParams.get("next"));
  const isReset = safeNext === RESET_PATH;
  const to = (path: string) => Response.redirect(new URL(path, requestUrl.origin), 307);
  const invalidPath = isReset
    ? "/reset-password?error=That password reset link is invalid or expired. Request a new one."
    : "/login?error=That sign-in link is invalid or expired.";

  if (!code) return to(invalidPath);

  const { error } = await deps.exchangeCodeForSession(code);

  if (error) {
    if (deps.isServiceUnavailable(error)) {
      return to(isReset
        ? "/reset-password?error=The password service is temporarily unavailable. Your reset link has not been treated as invalid; please try opening it again."
        : "/login?error=The sign-in service is temporarily unavailable. Your link has not been treated as invalid; please try opening it again.");
    }
    return to(invalidPath);
  }

  return to(safeNext);
}
