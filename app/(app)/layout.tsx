export const dynamic = "force-dynamic";

import AppShell from "@/components/AppShell";
import { createClient } from "@/utils/supabase/server";
import { getActiveSeason } from "@/utils/seasons";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

type AppLayoutProps = {
  children: ReactNode;
};

type AssignedGameweek = {
  id: string;
  gameweek_number: number;
  season_id: string;
};

type FixtureStatusRow = {
  status: string;
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

  const { data: assignedGameweeks } = activeSeason
    ? await supabase
        .from("gameweeks")
        .select("id, gameweek_number, season_id")
        .eq("season_id", activeSeason.id)
        .eq("fixture_picker_id", user.id)
        .order("gameweek_number", { ascending: true })
    : { data: null };

  const assignedGameweekList =
    (assignedGameweeks as AssignedGameweek[] | null) ?? [];

  let canPickFixtures = false;

  for (const assignedGameweek of assignedGameweekList) {
    if (assignedGameweek.gameweek_number === 1) {
      canPickFixtures = true;
      break;
    }

    const { data: previousGameweek } = await supabase
      .from("gameweeks")
      .select("id")
      .eq("season_id", assignedGameweek.season_id)
      .eq("gameweek_number", assignedGameweek.gameweek_number - 1)
      .maybeSingle();

    if (!previousGameweek) {
      continue;
    }

    const { data: previousFixtures } = await supabase
      .from("fixtures")
      .select("status")
      .eq("gameweek_id", previousGameweek.id);

    const previousFixtureList =
      (previousFixtures as FixtureStatusRow[] | null) ?? [];

    const previousGameweekComplete =
      previousFixtureList.length > 0 &&
      previousFixtureList.every((fixture) =>
        ["completed", "postponed", "void"].includes(fixture.status),
      );

    if (previousGameweekComplete) {
      canPickFixtures = true;
      break;
    }
  }

  return (
    <AppShell isAdmin={isAdmin} canPickFixtures={canPickFixtures}>
      {children}
    </AppShell>
  );
}
