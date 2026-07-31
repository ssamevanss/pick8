export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getActiveSeasonForLeague,
  isPlatformAdmin,
  requireLeagueMembership,
} from "@/utils/leagues";
import InviteShareButtons from "@/components/leagues/InviteShareButtons";
import SubmitButton from "@/components/forms/SubmitButton";
import ToastTrigger from "@/components/toast/ToastTrigger";
import {
  createLeagueInvite,
  toggleLeagueDoubleGameweek,
} from "@/app/leagues/actions";
import { getRequestAuthContext } from "@/utils/app-context";
import { logServerTiming, startServerTiming } from "@/utils/server-timing";
import { createAdminClient } from "@/utils/supabase/admin";

type MemberRow = {
  id: string;
  user_id: string;
  role: "player" | "league_admin";
  status: string;
  joined_at: string;
  profile: {
    display_name: string;
    email: string | null;
    status: string;
  } | null;
};

type ActiveSeasonSummary = {
  id: string;
  name: string;
  status: string;
};

type LeagueGameweekRow = {
  id: string;
  gameweek_number: number;
  name: string | null;
  fixture_picker_id: string | null;
  is_double_gameweek: boolean;
  fixtures:
    | {
        id: string;
        kickoff_at: string | null;
        status: string;
        predictions: { id: string }[] | null;
      }[]
    | null;
};

function getGameweekState(gameweek: LeagueGameweekRow) {
  const fixtures = gameweek.fixtures ?? [];

  if (fixtures.length === 0) {
    return { label: "Not picked", canToggleDouble: true, priority: 0 };
  }

  const allFinal = fixtures.every((fixture) =>
    ["completed", "void"].includes(fixture.status),
  );

  if (allFinal) {
    return { label: "Completed", canToggleDouble: false, priority: 2 };
  }

  const hasPredictions = fixtures.some(
    (fixture) => (fixture.predictions?.length ?? 0) > 0,
  );
  const hasLockedOrFinalFixture = fixtures.some((fixture) =>
    ["locked", "completed", "void"].includes(fixture.status),
  );
  const now = Date.now();
  const hasStarted = fixtures.some((fixture) => {
    const kickoff = fixture.kickoff_at
      ? Date.parse(fixture.kickoff_at)
      : Number.NaN;
    return Number.isFinite(kickoff) && kickoff <= now;
  });

  if (hasPredictions || hasLockedOrFinalFixture || hasStarted) {
    return { label: "Locked", canToggleDouble: false, priority: 1 };
  }

  return { label: "Picked", canToggleDouble: true, priority: 0 };
}

function getFirstKickoff(gameweek: LeagueGameweekRow) {
  const timestamps = (gameweek.fixtures ?? [])
    .flatMap((fixture) =>
      fixture.kickoff_at ? [Date.parse(fixture.kickoff_at)] : [],
    )
    .filter(Number.isFinite);

  if (timestamps.length === 0) {
    return null;
  }

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(Math.min(...timestamps)));
}

export default async function LeagueSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    league?: string;
    created?: string;
    invite_created?: string;
    updated?: string;
    gameweek?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const pageStartedAt = startServerTiming();
  const { league: leagueId, created } = params;
  const { supabase, user } = await getRequestAuthContext();

  if (!user) {
    redirect("/login");
  }

  if (!leagueId) {
    redirect("/leagues");
  }

  const platformAdmin = await isPlatformAdmin(supabase, user.id);
  let membership: Awaited<ReturnType<typeof requireLeagueMembership>> | null =
    null;

  if (!platformAdmin) {
    try {
      membership = await requireLeagueMembership(supabase, user.id, leagueId);
    } catch {
      redirect("/leagues?error=Membership+required");
    }
  }

  const canManageLeague =
    platformAdmin || membership?.role === "league_admin";

  const [{ data: league }, { data: season }, inviteResult, { data: memberships }] =
    await Promise.all([
      supabase
        .from("leagues")
        .select("id, name, status, default_base_competition_name")
        .eq("id", leagueId)
        .single(),
      getActiveSeasonForLeague(supabase, leagueId, "id, name, status"),
      canManageLeague
        ? supabase
            .from("league_invites")
            .select("id, code, expires_at, max_uses, use_count")
            .eq("league_id", leagueId)
            .is("disabled_at", null)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: null }),
      supabase
        .from("league_memberships")
        .select("id, user_id, role, status, joined_at")
        .eq("league_id", leagueId)
        .eq("status", "active")
        .order("joined_at", { ascending: true }),
    ]);
  const invites = inviteResult.data;
  const activeSeason = (season as ActiveSeasonSummary | null) ?? null;
  const adminSupabase = canManageLeague ? createAdminClient() : null;
  const { data: gameweekData } =
    adminSupabase && activeSeason
      ? await adminSupabase
          .from("gameweeks")
          .select(
            `
            id,
            gameweek_number,
            name,
            fixture_picker_id,
            is_double_gameweek,
            fixtures (
              id,
              kickoff_at,
              status,
              predictions (id)
            )
          `,
          )
          .eq("season_id", activeSeason.id)
          .order("gameweek_number", { ascending: true })
      : { data: [] };
  const rawGameweeks = (gameweekData as LeagueGameweekRow[] | null) ?? [];
  const rawMemberships =
    (memberships as Omit<MemberRow, "profile">[] | null) ?? [];
  const profileIds = Array.from(
    new Set([
      ...rawMemberships.map((member) => member.user_id),
      ...rawGameweeks.flatMap((gameweek) =>
        gameweek.fixture_picker_id ? [gameweek.fixture_picker_id] : [],
      ),
    ]),
  );
  const profileClient = adminSupabase ?? supabase;
  const { data: profiles } = profileIds.length
    ? await profileClient
        .from("profiles")
        .select("id, display_name, email, status")
        .in("id", profileIds)
    : { data: [] };
  const profilesById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile]),
  );
  const memberRows: MemberRow[] = rawMemberships.map((member) => ({
    ...member,
    profile: profilesById.get(member.user_id) ?? null,
  }));
  const gameweeks = [...rawGameweeks].sort((left, right) => {
    const priorityDifference =
      getGameweekState(left).priority - getGameweekState(right).priority;

    return priorityDifference || left.gameweek_number - right.gameweek_number;
  });

  logServerTiming("league.settings.page", pageStartedAt, {
    userId: user.id,
    leagueId,
    memberCount: memberRows.length,
  });

  return (
    <div className="mx-auto w-full max-w-6xl text-white">
      <header className="brand-card p-5 sm:p-7">
        <p className="brand-eyebrow">
          {canManageLeague ? "League administration" : "League details"}
        </p>
        <h1 className="brand-title mt-2">{league?.name ?? "League"}</h1>
        <p className="brand-subtitle mt-2">
          {canManageLeague
            ? "Manage this league’s invites, members, picker schedule, and safe future Double Gameweeks. Season creation, rollover, archiving, providers, results, and platform maintenance remain platform-admin only."
            : "You can view this league and its members. League controls are available to league admins."}
        </p>
        <Link href="/leagues" className="brand-button-secondary mt-5">
          Back to leagues
        </Link>
      </header>

      {created ? (
        <p className="brand-alert-success mt-4">
          League created and ready to play. Share the invite below.
        </p>
      ) : null}
      {params.invite_created ? (
        <p className="brand-alert-success mt-4">Invite code created.</p>
      ) : null}
      {params.updated === "double-gameweek-enabled" ? (
        <ToastTrigger
          title="Double Gameweek enabled"
          description="All points will count double and Jokers are unavailable."
          triggerKey={`league:${leagueId}:${params.gameweek ?? "gameweek"}:double-gameweek-enabled`}
        />
      ) : null}
      {params.updated === "double-gameweek-disabled" ? (
        <ToastTrigger
          title="Double Gameweek disabled"
          description="Normal scoring and Joker rules are restored for this gameweek."
          triggerKey={`league:${leagueId}:${params.gameweek ?? "gameweek"}:double-gameweek-disabled`}
        />
      ) : null}
      {params.error ? (
        <>
          <ToastTrigger
            title="League update failed"
            description={params.error}
            tone="error"
            triggerKey={`league:${leagueId}:error:${params.error}`}
          />
          <p className="brand-alert-danger mt-4">{params.error}</p>
        </>
      ) : null}

      <section className="brand-card mt-5 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="brand-eyebrow">League details</p>
            <h2 className="mt-1 text-2xl font-black">At a glance</h2>
          </div>
          <span className="brand-pill">
            {league?.status ?? "Status unavailable"}
          </span>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="brand-card-soft p-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Competition
            </dt>
            <dd className="mt-1 font-semibold text-white">
              {league?.default_base_competition_name ?? "Not configured"}
            </dd>
          </div>
          <div className="brand-card-soft p-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Active season
            </dt>
            <dd className="mt-1 font-semibold text-white">
              {activeSeason?.name ?? "This league is between seasons"}
            </dd>
          </div>
          <div className="brand-card-soft p-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Active members
            </dt>
            <dd className="mt-1 font-semibold text-white">
              {memberRows.length}
            </dd>
          </div>
        </dl>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        {canManageLeague ? (
          <section className="brand-card p-5 sm:p-6">
            <p className="brand-eyebrow">Share your league</p>
            <h2 className="mt-1 text-2xl font-black">Invite players</h2>
            <p className="mt-1 text-sm text-slate-400">
              Send the code or invite link to anyone you want to join.
            </p>
            {invites?.length ? (
              <div className="mt-3 space-y-2">
                {invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="brand-card-soft flex flex-col gap-2 p-4 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between"
                  >
                    <code className="text-lg font-black tracking-[0.18em] text-emerald-200">
                      {invite.code}
                    </code>
                    <span className="text-xs text-slate-400">
                      {invite.use_count}
                      {invite.max_uses ? ` / ${invite.max_uses}` : ""} uses
                    </span>
                  </div>
                ))}
                <InviteShareButtons
                  code={invites[0].code}
                  leagueName={league?.name ?? "my league"}
                />
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-slate-950/35 p-4">
                <p className="text-sm text-slate-300">
                  This league does not have an active invite yet.
                </p>
                <form action={createLeagueInvite} className="mt-3">
                  <input type="hidden" name="league_id" value={leagueId} />
                  <SubmitButton
                    idleLabel="Create invite code"
                    pendingLabel="Creating invite..."
                    className="brand-button-primary"
                  />
                </form>
              </div>
            )}
          </section>
        ) : null}

        <section className="brand-card p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-black">Members</h2>
            <span className="brand-pill">
              {memberRows.length} {memberRows.length === 1 ? "member" : "members"}
            </span>
          </div>
          <div className="mt-3 divide-y divide-white/10">
            {memberRows.map((member) => {
              const profile = member.profile;

              return (
                <div
                  key={member.id}
                  className="flex flex-col gap-2 py-3 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between"
                >
                  <div>
                    <p className="font-semibold">
                      {profile?.display_name ?? "Unknown member"}
                    </p>
                    {profile?.email ? (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {profile.email}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-500">
                      Joined {new Intl.DateTimeFormat("en-AU", {
                        dateStyle: "medium",
                      }).format(new Date(member.joined_at))}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="brand-pill">
                      {member.role === "league_admin"
                        ? "League admin"
                        : "Player"}
                    </span>
                    <span className="brand-pill capitalize">
                      {member.status}
                    </span>
                  </div>
                </div>
              );
            })}
            {memberRows.length === 0 ? (
              <p className="py-5 text-sm text-slate-400">
                No active members were found for this league.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      {canManageLeague ? (
        <section className="brand-card mt-5 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="brand-eyebrow">Active season schedule</p>
              <h2 className="mt-1 text-2xl font-black">Gameweek pickers</h2>
              <p className="mt-1 text-sm text-slate-400">
                Future and current gameweeks appear first. Picker reassignment
                remains a platform operation for now.
              </p>
            </div>
            {activeSeason ? (
              <span className="brand-pill">{activeSeason.name}</span>
            ) : null}
          </div>

          {!activeSeason ? (
            <p className="brand-card-soft mt-4 p-4 text-sm text-amber-200">
              This league is between seasons. A platform admin can create the
              next season.
            </p>
          ) : null}

          {activeSeason && gameweeks.length === 0 ? (
            <p className="brand-card-soft mt-4 p-4 text-sm text-slate-400">
              No gameweeks were found for the active season.
            </p>
          ) : null}

          {gameweeks.length > 0 ? (
            <div className="mt-5 space-y-3">
              {gameweeks.map((gameweek) => {
                const state = getGameweekState(gameweek);
                const picker = gameweek.fixture_picker_id
                  ? profilesById.get(gameweek.fixture_picker_id)
                  : null;
                const firstKickoff = getFirstKickoff(gameweek);

                return (
                  <article
                    key={gameweek.id}
                    className="brand-card-soft grid gap-4 p-4 lg:grid-cols-[1fr_1fr_0.8fr_1.3fr] lg:items-center"
                  >
                    <div>
                      <p className="font-black text-white">
                        {gameweek.name ||
                          `Gameweek ${gameweek.gameweek_number}`}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {firstKickoff
                          ? `First kickoff ${firstKickoff}`
                          : "Kickoff not set"}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Picker
                      </p>
                      <p className="mt-1 font-semibold text-slate-200">
                        {picker?.display_name ?? "Unassigned"}
                      </p>
                      {picker?.email ? (
                        <p className="mt-0.5 text-xs text-slate-500">
                          {picker.email}
                        </p>
                      ) : null}
                    </div>

                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Fixture status
                      </p>
                      <span
                        className={`mt-1 inline-flex rounded-full px-2 py-1 text-xs font-bold ${
                          state.label === "Completed"
                            ? "bg-slate-400/10 text-slate-300"
                            : state.label === "Locked"
                              ? "bg-amber-300/10 text-amber-200"
                              : "bg-emerald-400/10 text-emerald-200"
                        }`}
                      >
                        {state.label}
                      </span>
                    </div>

                    <div className="rounded-xl border border-amber-300/15 bg-amber-300/5 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-bold text-white">Double Gameweek</p>
                          <p className="mt-1 text-xs leading-relaxed text-slate-400">
                            All points count double. Jokers are unavailable for
                            this gameweek.
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-black ${
                            gameweek.is_double_gameweek
                              ? "bg-amber-300 text-slate-950"
                              : "bg-slate-800 text-slate-300"
                          }`}
                        >
                          {gameweek.is_double_gameweek ? "On" : "Off"}
                        </span>
                      </div>
                      <form
                        action={toggleLeagueDoubleGameweek}
                        className="mt-3"
                      >
                        <input
                          type="hidden"
                          name="gameweek_id"
                          value={gameweek.id}
                        />
                        <input
                          type="hidden"
                          name="enabled"
                          value={
                            gameweek.is_double_gameweek ? "false" : "true"
                          }
                        />
                        <SubmitButton
                          idleLabel={
                            gameweek.is_double_gameweek ? "Turn off" : "Turn on"
                          }
                          pendingLabel="Saving..."
                          disabled={!state.canToggleDouble}
                          className="brand-button-secondary w-full"
                        />
                      </form>
                      {!state.canToggleDouble ? (
                        <p className="mt-2 text-xs text-slate-500">
                          Locked after kickoff, final fixtures, or submitted
                          predictions.
                        </p>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
