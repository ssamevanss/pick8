"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/legacy-server";
import {
  requireLeagueAdmin,
  requireLeagueMembership,
  SELECTED_LEAGUE_COOKIE,
} from "@/utils/leagues";
import { createAdminClient } from "@/utils/supabase/legacy-admin";
import { getFootballDataCompetitionOption } from "@/utils/football-competitions";

const SUPPORTED_LEAGUE_COMPETITIONS = new Set([
  "PL",
  "PD",
  "SA",
  "BL1",
  "FL1",
]);

function messageFromError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Something went wrong";
}

async function requireApprovedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.status !== "approved") {
    redirect("/pending");
  }

  return { supabase, user };
}

async function rememberLeague(leagueId: string) {
  const cookieStore = await cookies();
  cookieStore.set(SELECTED_LEAGUE_COOKIE, leagueId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function createLeague(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const initialSeasonName = String(
    formData.get("initial_season_name") ?? "",
  ).trim();
  const baseCompetitionCode = String(
    formData.get("base_competition_code") ?? "",
  )
    .trim()
    .toUpperCase();
  const creationKey = String(formData.get("creation_key") ?? "").trim();
  let leagueId: string | null = null;
  const { supabase } = await requireApprovedUser();
  const competition = getFootballDataCompetitionOption(baseCompetitionCode);

  if (name.length < 2 || name.length > 80) {
    redirect(
      "/leagues/create?error=League+name+must+be+between+2+and+80+characters",
    );
  }

  if (initialSeasonName.length < 2 || initialSeasonName.length > 100) {
    redirect(
      "/leagues/create?error=Current+season+name+must+be+between+2+and+100+characters",
    );
  }

  if (
    !competition ||
    !SUPPORTED_LEAGUE_COMPETITIONS.has(baseCompetitionCode)
  ) {
    redirect(
      "/leagues/create?error=Choose+a+supported+base+competition",
    );
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      creationKey,
    )
  ) {
    redirect("/leagues/create?error=Invalid+creation+request");
  }

  try {
    const { data, error } = await supabase.rpc(
      "create_league_for_current_user",
      {
        league_name: name,
        base_competition_code: baseCompetitionCode,
        request_creation_key: creationKey,
        initial_season_name: initialSeasonName,
      },
    );

    if (error) {
      throw error;
    }

    const result = Array.isArray(data) ? data[0] : data;
    leagueId = result?.league_id ?? null;

    if (!leagueId) {
      throw new Error("The league could not be created");
    }
  } catch (error) {
    redirect(
      `/leagues/create?error=${encodeURIComponent(messageFromError(error))}`,
    );
  }

  await rememberLeague(leagueId);
  revalidatePath("/leagues");
  redirect(`/league/settings?league=${leagueId}&created=1`);
}

export async function joinLeague(formData: FormData) {
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  let leagueId: string | null = null;
  const { supabase } = await requireApprovedUser();

  try {
    const { data, error } = await supabase.rpc("join_league_by_code", {
      invite_code: code,
    });

    if (error) {
      throw error;
    }

    leagueId = typeof data === "string" ? data : null;

    if (!leagueId) {
      throw new Error("The league could not be joined");
    }
  } catch (error) {
    redirect(
      `/leagues/join?error=${encodeURIComponent(messageFromError(error))}`,
    );
  }

  await rememberLeague(leagueId);
  revalidatePath("/leagues");
  redirect("/dashboard?joined=1");
}

export async function createLeagueInvite(formData: FormData) {
  const leagueId = String(formData.get("league_id") ?? "").trim();
  const { supabase, user } = await requireApprovedUser();

  if (!leagueId) {
    redirect("/leagues?error=Missing+league");
  }

  try {
    await requireLeagueAdmin(supabase, user.id, leagueId);

    const adminSupabase = createAdminClient();
    let created = false;

    for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
      const code = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
      const { error } = await adminSupabase.from("league_invites").insert({
        league_id: leagueId,
        code,
        created_by: user.id,
      });

      if (!error) {
        created = true;
      } else if (error.code !== "23505") {
        throw error;
      }
    }

    if (!created) {
      throw new Error("Could not generate a unique invite code");
    }
  } catch (error) {
    redirect(
      `/league/settings?league=${leagueId}&error=${encodeURIComponent(messageFromError(error))}`,
    );
  }

  revalidatePath("/league/settings");
  redirect(`/league/settings?league=${leagueId}&invite_created=1`);
}

type LeagueGameweekForToggle = {
  id: string;
  is_double_gameweek: boolean | null;
  seasons:
    | { league_id: string | null; status: string; is_active: boolean | null }
    | { league_id: string | null; status: string; is_active: boolean | null }[]
    | null;
  fixtures:
    | {
        id: string;
        kickoff_at: string | null;
        status: string;
        predictions: { id: string }[] | null;
      }[]
    | null;
};

function firstRelation<T>(value: T | T[] | null) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function toggleLeagueDoubleGameweek(formData: FormData) {
  const gameweekId = String(formData.get("gameweek_id") ?? "").trim();
  const enabled = String(formData.get("enabled") ?? "") === "true";
  const { supabase, user } = await requireApprovedUser();
  let leagueId: string | null = null;
  let errorMessage: string | null = null;

  try {
    if (!gameweekId) {
      throw new Error("Missing gameweek");
    }

    const adminSupabase = createAdminClient();
    const { data, error } = await adminSupabase
      .from("gameweeks")
      .select(
        `
        id,
        is_double_gameweek,
        seasons!inner (
          league_id,
          status,
          is_active
        ),
        fixtures (
          id,
          kickoff_at,
          status,
          predictions (id)
        )
      `,
      )
      .eq("id", gameweekId)
      .maybeSingle();

    if (error || !data) {
      throw new Error(error?.message ?? "Gameweek not found");
    }

    const gameweek = data as LeagueGameweekForToggle;
    const season = firstRelation(gameweek.seasons);
    leagueId = season?.league_id ?? null;

    if (!leagueId || !season) {
      throw new Error("This gameweek is not attached to a league");
    }

    await requireLeagueAdmin(supabase, user.id, leagueId);

    if (season.status !== "active" && season.is_active !== true) {
      throw new Error(
        "Double Gameweek can only be changed for an active season",
      );
    }

    const fixtures = gameweek.fixtures ?? [];
    const hasPredictions = fixtures.some(
      (fixture) => (fixture.predictions?.length ?? 0) > 0,
    );
    const hasLockedOrFinalFixture = fixtures.some((fixture) =>
      ["locked", "completed", "void"].includes(fixture.status),
    );
    const now = Date.now();
    const hasStarted = fixtures.some((fixture) => {
      if (!fixture.kickoff_at) {
        return false;
      }

      const kickoff = Date.parse(fixture.kickoff_at);
      return Number.isFinite(kickoff) && kickoff <= now;
    });

    if (hasPredictions) {
      throw new Error(
        "Double Gameweek cannot change after predictions have been submitted",
      );
    }

    if (hasLockedOrFinalFixture) {
      throw new Error(
        "Double Gameweek cannot change after fixtures are locked or final",
      );
    }

    if (hasStarted) {
      throw new Error(
        "Double Gameweek cannot change after the gameweek has started",
      );
    }

    const currentValue = Boolean(gameweek.is_double_gameweek);

    if (currentValue !== enabled) {
      const { data: updatedGameweek, error: updateError } = await adminSupabase
        .from("gameweeks")
        .update({ is_double_gameweek: enabled })
        .eq("id", gameweekId)
        .eq("is_double_gameweek", currentValue)
        .select("id")
        .maybeSingle();

      if (updateError || !updatedGameweek) {
        throw new Error(
          updateError?.message ??
            "The gameweek changed while you were editing it. Please try again.",
        );
      }

      if (enabled && fixtures.length > 0) {
        const { error: jokerDeleteError } = await adminSupabase
          .from("joker_usage")
          .delete()
          .in(
            "fixture_id",
            fixtures.map((fixture) => fixture.id),
          );

        if (jokerDeleteError) {
          await adminSupabase
            .from("gameweeks")
            .update({ is_double_gameweek: currentValue })
            .eq("id", gameweekId);
          throw new Error(jokerDeleteError.message);
        }
      }
    }
  } catch (error) {
    errorMessage = messageFromError(error);
  }

  if (!leagueId) {
    redirect(
      `/leagues?error=${encodeURIComponent(errorMessage ?? "League not found")}`,
    );
  }

  if (errorMessage) {
    redirect(
      `/league/settings?league=${leagueId}&error=${encodeURIComponent(errorMessage)}`,
    );
  }

  revalidatePath("/league/settings");
  revalidatePath("/dashboard");
  revalidatePath("/predictions");
  revalidatePath("/leaderboard");
  redirect(
    `/league/settings?league=${leagueId}&updated=double-gameweek-${enabled ? "enabled" : "disabled"}&gameweek=${gameweekId}`,
  );
}

export async function setDefaultLeague(leagueId: string | null) {
  const normalizedLeagueId = leagueId?.trim() || null;
  const { supabase, user } = await requireApprovedUser();

  if (normalizedLeagueId) {
    try {
      await requireLeagueMembership(supabase, user.id, normalizedLeagueId);
    } catch {
      return { error: "Active league membership required" };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ default_league_id: normalizedLeagueId })
    .eq("id", user.id);

  if (error) {
    return { error: messageFromError(error) };
  }

  revalidatePath("/leagues");
  return { error: null };
}
