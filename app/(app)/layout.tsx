export const dynamic = "force-dynamic";

import AppShell from "@/components/AppShell";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getRequestAuthContext } from "@/utils/app-context";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { supabase, user, profile, profileError } =
    await getRequestAuthContext();

  if (!user) {
    redirect("/login");
  }

  if (profileError || !profile) {
    await supabase.auth.signOut();
    redirect(
      "/login?error=Your+Pick8+profile+is+not+configured.+Ask+the+administrator+for+help.",
    );
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    redirect(
      "/login?error=Your+Pick8+account+is+inactive.+Ask+the+administrator+for+help.",
    );
  }

  return <AppShell isAdmin={profile.is_admin}>{children}</AppShell>;
}
