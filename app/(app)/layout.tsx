export const dynamic = "force-dynamic";

import AppShell from "@/components/AppShell";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import type { HeaderUserNotification } from "@/components/notifications/NotificationBell";
import { SELECTED_LEAGUE_COOKIE } from "@/utils/leagues";
import { cookies } from "next/headers";
import {
  getAppLeagueContext,
  getRequestEditablePickerGameweeks,
} from "@/utils/app-context";
import {
  logServerTiming,
  startServerTiming,
  withServerTiming,
} from "@/utils/server-timing";

type AppLayoutProps = {
  children: ReactNode;
};

export default async function AppLayout({ children }: AppLayoutProps) {
  const layoutStartedAt = startServerTiming();
  const {
    supabase,
    user,
    profile,
    selectedLeague,
    leagues,
  } = await getAppLeagueContext();

  if (!user) {
    redirect("/login");
  }

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

  const rememberedLeagueId = (await cookies()).get(
    SELECTED_LEAGUE_COOKIE,
  )?.value;

  if (
    rememberedLeagueId &&
    !leagues.some((league) => league.id === rememberedLeagueId)
  ) {
    redirect("/leagues?error=Your+previously+selected+league+is+no+longer+available");
  }

  if (!selectedLeague) {
    redirect("/leagues");
  }

  const [editablePickerGameweeks, { data: userNotifications }] =
    await Promise.all([
      getRequestEditablePickerGameweeks(),
      withServerTiming(
        "header.notifications",
        () =>
          supabase
            .from("user_notifications")
            .select(
              "id, title, body, read_at, updated_at, notification_type, target_type, target_id, metadata",
            )
            .eq("user_id", user.id)
            .order("read_at", { ascending: true, nullsFirst: true })
            .order("updated_at", { ascending: false })
            .limit(30),
        { userId: user.id, leagueId: selectedLeague.id },
      ),
    ]);
  const canPickFixtures = editablePickerGameweeks.length > 0;
  const notifications = (
    (userNotifications as HeaderUserNotification[] | null) ?? []
  ).filter((notification) => {
    const leagueId = notification.metadata?.leagueId;

    return typeof leagueId !== "string" || leagueId === selectedLeague.id;
  });
  const unreadNotificationCount = notifications.filter(
    (notification) => !notification.read_at,
  ).length;
  logServerTiming("app.layout", layoutStartedAt, {
    userId: user.id,
    leagueId: selectedLeague.id,
  });

  return (
    <AppShell
      canPickFixtures={canPickFixtures}
      notifications={notifications}
      unreadNotificationCount={unreadNotificationCount}
    >
      {children}
    </AppShell>
  );
}
