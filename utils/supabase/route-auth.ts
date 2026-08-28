import "server-only";

import type { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/legacy-server";
import {
  classifyServerAuth,
  serviceUnavailableResponse,
} from "@/utils/supabase/resilience";

type LegacyServerClient = Awaited<ReturnType<typeof createClient>>;

type ApprovedProfile = {
  role: string | null;
  status: string | null;
};

type ApprovedRouteUserResult =
  | { ok: true; user: User; profile: ApprovedProfile }
  | { ok: false; response: Response };

export async function requireApprovedRouteUser(
  supabase: LegacyServerClient,
): Promise<ApprovedRouteUserResult> {
  const { data, error } = await supabase.auth.getUser();
  const authState = classifyServerAuth({ user: data.user, error });

  if (authState.kind === "unavailable") {
    return { ok: false, response: serviceUnavailableResponse() };
  }
  if (authState.kind === "unauthenticated" || !data.user) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) {
    return { ok: false, response: serviceUnavailableResponse() };
  }
  if (!profile || profile.status !== "approved") {
    return {
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    user: data.user,
    profile: profile as ApprovedProfile,
  };
}

export async function requireApprovedAdminRoute(
  supabase: LegacyServerClient,
) {
  const result = await requireApprovedRouteUser(supabase);
  if (!result.ok) return result;

  if (result.profile.role !== "admin") {
    return {
      ok: false as const,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return result;
}
