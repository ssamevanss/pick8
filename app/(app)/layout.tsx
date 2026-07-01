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

type FixtureActionRow = {
  id: string;
  status: string;
};

function isTerminalFixtureStatus(status: string) {
  return ["completed", "postponed", "void"].includes(status);
}

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
    let previousGameweekComplete = assignedGameweek.gameweek_number === 1;

    if (assignedGameweek.gameweek_number === 1) {
      previousGameweekComplete = true;
    } else {
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

      previousGameweekComplete =
        previousFixtureList.length > 0 &&
        previousFixtureList.every((fixture) =>
          isTerminalFixtureStatus(fixture.status),
        );
    }

    if (!previousGameweekComplete) {
      continue;
    }

    const { data: fixtures } = await supabase
      .from("fixtures")
      .select("id, status")
      .eq("gameweek_id", assignedGameweek.id);

    const fixtureList = (fixtures as FixtureActionRow[] | null) ?? [];
    const allFixturesClosed =
      fixtureList.length > 0 &&
      fixtureList.every((fixture) => isTerminalFixtureStatus(fixture.status));

    if (allFixturesClosed) {
      continue;
    }

    const fixtureIds = fixtureList.map((fixture) => fixture.id);
    const { data: existingPrediction } =
      fixtureIds.length > 0
        ? await supabase
            .from("predictions")
            .select("fixture_id")
            .in("fixture_id", fixtureIds)
            .limit(1)
            .maybeSingle()
        : { data: null };

    if (!existingPrediction) {
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
