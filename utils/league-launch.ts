import "server-only";

import type { createClient } from "@/utils/supabase/server";
import {
  getActiveSeasonForLeague,
  requireLeagueMembership,
} from "@/utils/leagues";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type LeagueLaunchDecision = {
  destination: "/dashboard" | "/leagues" | "/pending";
  selectedLeagueId: string | null;
};

export async function getLeagueLaunchDecision(
  supabase: SupabaseClient,
  userId: string,
): Promise<LeagueLaunchDecision> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("status, default_league_id")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.status === "pending") {
    return { destination: "/pending", selectedLeagueId: null };
  }

  if (profile?.status !== "approved" || !profile.default_league_id) {
    return { destination: "/leagues", selectedLeagueId: null };
  }

  try {
    await requireLeagueMembership(
      supabase,
      userId,
      profile.default_league_id,
    );
    const { data: activeSeason } = await getActiveSeasonForLeague(
      supabase,
      profile.default_league_id,
      "id",
    );

    if (!activeSeason) {
      return { destination: "/leagues", selectedLeagueId: null };
    }
  } catch {
    return { destination: "/leagues", selectedLeagueId: null };
  }

  return {
    destination: "/dashboard",
    selectedLeagueId: profile.default_league_id,
  };
}
