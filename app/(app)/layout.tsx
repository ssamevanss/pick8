export const dynamic = "force-dynamic";

import AppShell from "@/components/AppShell";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getRequestAuthContext } from "@/utils/app-context";
import {
  classifyServerAuth,
  Pick8ServiceUnavailableError,
} from "@/utils/supabase/resilience";

async function signOutConclusiveSession(
  supabase: Awaited<ReturnType<typeof getRequestAuthContext>>["supabase"],
) {
  const { error } = await supabase.auth.signOut();
  if (!error) return;

  const state = classifyServerAuth({ user: null, error });
  if (state.kind === "unavailable") {
    throw new Pick8ServiceUnavailableError("auth");
  }
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { supabase, user, profile } = await getRequestAuthContext();

  if (!user) {
    redirect("/login");
  }

  if (!profile) {
    await signOutConclusiveSession(supabase);
    redirect(
      "/login?error=Your+Pick8+profile+is+not+configured.+Ask+the+administrator+for+help.",
    );
  }

  if (!profile.is_active) {
    await signOutConclusiveSession(supabase);
    redirect(
      "/login?error=Your+Pick8+account+is+inactive.+Ask+the+administrator+for+help.",
    );
  }

  return <AppShell isAdmin={profile.is_admin}>{children}</AppShell>;
}
