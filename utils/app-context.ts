import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { withServerTiming } from "@/utils/server-timing";
import type { Tables } from "@/types/database.types";
import {
  classifyServerAuth,
  INTERACTIVE_PAGE_TIMEOUT_MS,
  Pick8ServiceUnavailableError,
} from "@/utils/supabase/resilience";

export type Pick8Profile = Tables<"profiles">;

export const getRequestAuthContext = cache(async () => {
  const requestDeadlineSignal = AbortSignal.timeout(INTERACTIVE_PAGE_TIMEOUT_MS);
  const requestHeaders = await headers();
  const requestId = requestHeaders.get("x-vercel-id") ??
    requestHeaders.get("x-request-id");
  const supabase = await createClient({
    overallSignal: requestDeadlineSignal,
    context: {
      page: "protected-app",
      operation: "request-auth-context",
      requestId,
    },
  });
  const { data: authData, error: authError } = await withServerTiming(
    "auth.getUser",
    () => supabase.auth.getUser(),
    { area: "app-context" },
  );
  const authState = classifyServerAuth({
    user: authData.user,
    error: authError,
  });

  if (authState.kind === "unavailable") {
    throw new Pick8ServiceUnavailableError("auth");
  }

  const user = authState.kind === "authenticated" ? authData.user : null;
  const { data: profile, error: profileError } = user
    ? await withServerTiming(
        "profiles.current",
        () =>
          supabase
            .from("profiles")
            .select(
              "id, email, display_name, is_admin, is_active, pick8_participation_active, created_at, updated_at",
            )
            .eq("id", user.id)
            .maybeSingle(),
        { area: "app-context", userId: user.id },
      )
    : { data: null, error: null };

  if (profileError) {
    throw new Pick8ServiceUnavailableError("database");
  }

  return {
    supabase,
    user,
    profile,
    requestDeadlineSignal,
    requestId,
  };
});
