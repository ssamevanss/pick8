import "server-only";

import { cache } from "react";
import { createClient } from "@/utils/supabase/server";
import { withServerTiming } from "@/utils/server-timing";

export type Pick8Profile = {
  id: string;
  email: string | null;
  display_name: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export const getRequestAuthContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await withServerTiming(
    "auth.getUser",
    () => supabase.auth.getUser(),
    { area: "app-context" },
  );
  const { data: profile, error: profileError } = user
    ? await withServerTiming(
        "profiles.current",
        () =>
          supabase
            .from("profiles")
            .select(
              "id, email, display_name, is_admin, is_active, created_at, updated_at",
            )
            .eq("id", user.id)
            .maybeSingle(),
        { area: "app-context", userId: user.id },
      )
    : { data: null, error: null };

  return {
    supabase,
    user,
    profile: profile as Pick8Profile | null,
    profileError,
  };
});
