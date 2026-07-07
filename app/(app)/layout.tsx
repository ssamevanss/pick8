export const dynamic = "force-dynamic";

import AppShell from "@/components/AppShell";
import { createClient } from "@/utils/supabase/server";
import { getActiveSeason } from "@/utils/seasons";
import { getEditablePickerGameweeks } from "@/utils/picker-eligibility";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import type { HeaderUserNotification } from "@/components/notifications/NotificationBell";

type AppLayoutProps = {
  children: ReactNode;
};

export default async function AppLayout({ children }: AppLayoutProps) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    await supabase.auth.signOut();
    redirect(
      "/login?error=No league profile found. Ask the admin for access.",
    );
  }

  if (profile.status === "pending") {
    redirect("/pending");
  }

  if (profile.status === "rejected") {
    await supabase.auth.signOut();
    redirect("/login?error=Your account request was not approved.");
  }

  if (profile.status === "disabled") {
    await supabase.auth.signOut();
    redirect("/login?error=Your account has been disabled.");
  }

  const isAdmin = profile.role === "admin";

  const { data: activeSeason } = await getActiveSeason(supabase, "id");

  const editablePickerGameweeks = activeSeason
    ? await getEditablePickerGameweeks({
        supabase,
        userId: user.id,
        activeSeasonId: activeSeason.id,
      })
    : [];
  const canPickFixtures = editablePickerGameweeks.length > 0;
  const { data: userNotifications } = await supabase
    .from("user_notifications")
    .select("id, title, body, read_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(12);
  const notifications =
    (userNotifications as HeaderUserNotification[] | null) ?? [];

  return (
    <AppShell
      isAdmin={isAdmin}
      canPickFixtures={canPickFixtures}
      notifications={notifications}
    >
      {children}
    </AppShell>
  );
}
