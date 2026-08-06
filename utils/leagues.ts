import { cookies } from "next/headers";
import type { createClient } from "@/utils/supabase/legacy-server";
import { withServerTiming } from "@/utils/server-timing";

export const SELECTED_LEAGUE_COOKIE = "selected_league_id";

export type LeagueMembershipRole = "player" | "league_admin";

export type UserLeague = {
  id: string;
  name: string;
  status: string;
  role: LeagueMembershipRole;
  baseCompetitionName: string | null;
};

type QueryResult<T> = {
  data: T | null;
  error: { message?: string } | null;
};

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export async function getUserLeagues(
  supabase: SupabaseLike,
  userId: string,
): Promise<UserLeague[]> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.status !== "approved") {
    return [];
  }

  const { data, error } = (await withServerTiming(
    "leagues.user-list",
    () =>
      supabase
        .from("league_memberships")
        .select(
          "role, leagues!inner(id, name, status, default_base_competition_name)",
        )
        .eq("user_id", userId)
        .eq("status", "active")
        .eq("leagues.status", "active")
        .order("joined_at", { ascending: true }),
    { userId },
  )) as QueryResult<
    {
      role: LeagueMembershipRole;
      leagues:
        | {
            id: string;
            name: string;
            status: string;
            default_base_competition_name: string | null;
          }
        | {
            id: string;
            name: string;
            status: string;
            default_base_competition_name: string | null;
          }[];
    }[]
  >;

  if (error) {
    throw new Error(error.message ?? "Could not load league memberships");
  }

  return (data ?? []).flatMap((membership) => {
    const league = one(membership.leagues);

    return league
      ? [
          {
            id: league.id,
            name: league.name,
            status: league.status,
            role: membership.role,
            baseCompetitionName:
              league.default_base_competition_name ?? null,
          },
        ]
      : [];
  });
}

export async function getSelectedLeagueForUser(
  supabase: SupabaseLike,
  userId: string,
  requestedLeagueId?: string | null,
) {
  const [leagues, cookieStore] = await Promise.all([
    getUserLeagues(supabase, userId),
    cookies(),
  ]);
  const rememberedLeagueId = cookieStore.get(SELECTED_LEAGUE_COOKIE)?.value;
  const selectedLeague =
    leagues.find((league) => league.id === requestedLeagueId) ??
    leagues.find((league) => league.id === rememberedLeagueId) ??
    leagues[0] ??
    null;

  return { selectedLeague, leagues };
}

export async function getActiveSeasonForLeague(
  supabase: SupabaseLike,
  leagueId: string,
  select = "id, name, status",
) {
  const activeByStatus = await supabase
    .from("seasons")
    .select(select)
    .eq("league_id", leagueId)
    .eq("status", "active")
    .maybeSingle();

  if (activeByStatus.data || activeByStatus.error) {
    return activeByStatus;
  }

  return supabase
    .from("seasons")
    .select(select)
    .eq("league_id", leagueId)
    .eq("is_active", true)
    .neq("status", "archived")
    .maybeSingle();
}

export async function requireLeagueMembership(
  supabase: SupabaseLike,
  userId: string,
  leagueId: string,
) {
  const [{ data: profile }, { data, error }] = await Promise.all([
    supabase
      .from("profiles")
      .select("status")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("league_memberships")
      .select("id, role, status, leagues!inner(status)")
      .eq("user_id", userId)
      .eq("league_id", leagueId)
      .eq("status", "active")
      .eq("leagues.status", "active")
      .maybeSingle(),
  ]);

  if (profile?.status !== "approved" || error || !data) {
    throw new Error("Active league membership required");
  }

  return data as {
    id: string;
    role: LeagueMembershipRole;
    status: "active";
  };
}

export async function requireLeagueAdmin(
  supabase: SupabaseLike,
  userId: string,
  leagueId: string,
) {
  if (await isPlatformAdmin(supabase, userId)) {
    return;
  }

  const membership = await requireLeagueMembership(
    supabase,
    userId,
    leagueId,
  );

  if (membership.role !== "league_admin") {
    throw new Error("League admin access required");
  }
}

export async function isPlatformAdmin(
  supabase: SupabaseLike,
  userId: string,
) {
  const { data } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", userId)
    .maybeSingle();

  return data?.status === "approved" && data?.role === "admin";
}
