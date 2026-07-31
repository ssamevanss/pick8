import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import type { HeaderUserNotification } from "@/components/notifications/NotificationBell";
import { getRequestAuthContext } from "@/utils/app-context";

export default async function LeaguesLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { supabase, user, profile } = await getRequestAuthContext();

  if (!user) {
    redirect("/login");
  }

  if (profile?.status === "pending") {
    redirect("/pending");
  }

  if (!profile || profile.status === "rejected" || profile.status === "disabled") {
    await supabase.auth.signOut();
    redirect("/login?error=Your+account+is+not+approved");
  }

  if (profile.status !== "approved") {
    redirect("/pending");
  }

  const { data: userNotifications } = await supabase
    .from("user_notifications")
    .select(
      "id, title, body, read_at, updated_at, notification_type, target_type, target_id, metadata",
    )
    .eq("user_id", user.id)
    .order("read_at", { ascending: true, nullsFirst: true })
    .order("updated_at", { ascending: false })
    .limit(30);
  const notifications =
    (userNotifications as HeaderUserNotification[] | null) ?? [];

  return (
    <AppShell
      notifications={notifications}
      unreadNotificationCount={notifications.filter((item) => !item.read_at).length}
      showBottomNavigation={false}
    >
      {children}
    </AppShell>
  );
}
