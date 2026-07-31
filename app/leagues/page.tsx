export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserLeagues } from "@/utils/leagues";
import PendingLeagueLink from "@/components/leagues/PendingLeagueLink";
import DefaultLeagueToggle from "@/components/leagues/DefaultLeagueToggle";
import { getRequestAuthContext } from "@/utils/app-context";
import { logServerTiming, startServerTiming } from "@/utils/server-timing";

type LeagueSeasonSummary = {
  id: string;
  league_id: string;
  name: string;
  status: string;
  is_active: boolean | null;
  show_in_archive: boolean;
  archived_at: string | null;
};

export default async function LeaguesPage({
  searchParams,
}: {
  searchParams: Promise<{
    created?: string;
    joined?: string;
    error?: string;
    default_saved?: string;
  }>;
}) {
  const params = await searchParams;
  const pageStartedAt = startServerTiming();
  const { supabase, user, profile } = await getRequestAuthContext();

  if (!user) {
    redirect("/login");
  }
  const { data: launchPreference } = await supabase
    .from("profiles")
    .select("default_league_id")
    .eq("id", user.id)
    .maybeSingle();
  const defaultLeagueId = launchPreference?.default_league_id ?? null;
  let leagues: Awaited<ReturnType<typeof getUserLeagues>> = [];
  let leagueLoadError: string | null = null;

  try {
    leagues = await getUserLeagues(supabase, user.id);
  } catch (error) {
    leagueLoadError =
      error instanceof Error ? error.message : "Could not load your leagues";
  }
  const leagueIds = leagues.map((league) => league.id);
  const [{ data: seasonRows }, { data: membershipRows }] = leagueIds.length
    ? await Promise.all([
        supabase
          .from("seasons")
          .select(
            "id, league_id, name, status, is_active, show_in_archive, archived_at",
          )
          .in("league_id", leagueIds)
          .in("status", ["active", "archived"])
          .order("archived_at", { ascending: false, nullsFirst: false }),
        supabase
          .from("league_memberships")
          .select("league_id")
          .in("league_id", leagueIds)
          .eq("status", "active"),
      ])
    : [{ data: [] }, { data: [] }];
  const activeSeasonByLeague = new Map<string, LeagueSeasonSummary>();
  const archivedSeasonByLeague = new Map<string, LeagueSeasonSummary>();

  for (const season of (seasonRows as LeagueSeasonSummary[] | null) ?? []) {
    if (season.status === "active") {
      activeSeasonByLeague.set(season.league_id, season);
    } else if (
      season.status === "archived" &&
      season.show_in_archive &&
      !archivedSeasonByLeague.has(season.league_id)
    ) {
      archivedSeasonByLeague.set(season.league_id, season);
    }
  }

  const memberCountByLeague = new Map<string, number>();

  for (const membership of membershipRows ?? []) {
    memberCountByLeague.set(
      membership.league_id,
      (memberCountByLeague.get(membership.league_id) ?? 0) + 1,
    );
  }

  const summaries = leagues.map((league) => ({
    leagueId: league.id,
    activeSeason: activeSeasonByLeague.get(league.id) ?? null,
    archivedSeason: archivedSeasonByLeague.get(league.id) ?? null,
    memberCount: memberCountByLeague.get(league.id) ?? 0,
  }));
  const summariesByLeague = new Map(
    summaries.map((summary) => [summary.leagueId, summary]),
  );
  const activeLeagues = leagues.filter((league) =>
    activeSeasonByLeague.has(league.id),
  );
  const pastLeagues = leagues.filter(
    (league) => !activeSeasonByLeague.has(league.id),
  );
  const defaultLeague = activeLeagues.find(
    (league) => league.id === defaultLeagueId,
  );

  logServerTiming("leagues.page", pageStartedAt, {
    userId: user.id,
    leagueCount: leagues.length,
  });

  return (
    <div className="mx-auto w-full max-w-6xl text-white">
        <header className="brand-card overflow-hidden p-5 sm:p-7">
          <p className="brand-eyebrow">League Hub</p>
          <h1 className="mt-1.5 text-3xl font-black tracking-tight text-white sm:text-4xl">
            Who You Got?
          </h1>
          <p className="brand-subtitle mt-2">
            Create a private prediction league with friends. Pick scores for
            selected football fixtures, earn points for correct results and
            exact scores, and climb the table across the season.
          </p>
          <p className="mt-3 text-sm text-slate-400">
            New here?{" "}
            <Link
              href="/rules"
              className="font-semibold text-emerald-200 underline decoration-emerald-300/40 underline-offset-4 hover:text-emerald-100"
            >
              Read the Rules
            </Link>{" "}
            for the full scoring breakdown.
          </p>
          {defaultLeague ? (
            <p className="mt-3 text-xs font-semibold text-slate-400">
              Default launch: <span className="text-emerald-200">{defaultLeague.name}</span>
            </p>
          ) : null}
          <div className="mt-5 flex flex-col gap-2 min-[420px]:flex-row">
            <PendingLeagueLink
              href="/leagues/create"
              idleLabel="Create league"
              pendingLabel="Opening..."
              className="brand-button-primary"
            />
            <PendingLeagueLink
              href="/leagues/join"
              idleLabel="Join league"
              pendingLabel="Opening..."
              className="brand-button-secondary"
            />
          </div>
        </header>

        {params.error ? (
          <p className="brand-alert-danger mt-4">{params.error}</p>
        ) : null}
        {leagueLoadError ? (
          <p className="brand-alert-danger mt-4">
            Your account is signed in, but league memberships could not be
            loaded: {leagueLoadError}
          </p>
        ) : null}
        {params.joined ? (
          <p className="brand-alert-success mt-4">You joined the league.</p>
        ) : null}
        {params.default_saved ? (
          <p className="brand-alert-success mt-4">
            Your default launch league has been updated.
          </p>
        ) : null}

        <div className="mt-7 flex items-end justify-between gap-4 px-1">
          <div>
            <p className="brand-eyebrow">League hub</p>
            <h2 className="mt-1 text-2xl font-black">Your leagues</h2>
          </div>
          <p className="hidden text-sm text-slate-400 sm:block">
            Choose where to play
          </p>
        </div>

        <section className="mt-4 space-y-4">
          {leagues.length === 0 ? (
            <div className="brand-card p-6 text-center sm:p-8">
              <h2 className="text-xl font-black">No leagues yet</h2>
              <p className="mt-2 text-sm text-slate-300">
                You’re not in any leagues yet. Create a league and its first
                season, or join with an invite code.
              </p>
            </div>
          ) : activeLeagues.length === 0 ? (
            <div className="brand-card p-6 text-center sm:p-8">
              <h2 className="text-xl font-black">No active leagues</h2>
              <p className="mt-2 text-sm text-slate-300">
                Your leagues are between seasons. Past results remain available
                below, and active play returns when a platform admin starts the
                next season.
              </p>
            </div>
          ) : (
            activeLeagues.map((league) => {
              const summary = summariesByLeague.get(league.id);
              const season = summary?.activeSeason;

              return (
                <article
                  key={league.id}
                  className={`brand-card p-4 sm:p-5 ${
                    defaultLeagueId === league.id
                      ? "border-emerald-300/45"
                      : ""
                  }`}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-xl font-black sm:text-2xl">
                        {league.name}
                      </h2>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="brand-pill text-emerald-200">
                          {league.role === "league_admin"
                            ? "Owner / Admin"
                            : "Player"}
                        </span>
                        <span className="brand-pill">
                          {summary?.memberCount ?? 0}{" "}
                          {(summary?.memberCount ?? 0) === 1
                            ? "member"
                            : "members"}
                        </span>
                        {defaultLeagueId === league.id ? (
                          <span className="brand-pill border-emerald-300/30 text-emerald-200">
                            Default launch
                          </span>
                        ) : null}
                      </div>
                      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                            Competition
                          </dt>
                          <dd className="mt-0.5 font-semibold text-slate-200">
                            {league.baseCompetitionName ?? "Not configured"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                            Active season
                          </dt>
                          <dd className="mt-0.5 font-semibold text-slate-200">
                            {season?.name ?? "Season setup pending"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 sm:w-48">
                      <PendingLeagueLink
                        href={`/leagues/select?league=${league.id}&next=/dashboard`}
                        idleLabel="Open league"
                        pendingLabel="Opening..."
                        className="brand-button-primary w-full"
                      />
                      {league.role === "league_admin" ||
                      profile?.role === "admin" ? (
                        <PendingLeagueLink
                          href={`/league/settings?league=${league.id}`}
                          idleLabel="Manage & invite"
                          pendingLabel="Opening..."
                          className="brand-button-secondary w-full"
                        />
                      ) : null}
                      <div className="flex justify-start pt-1 sm:justify-center">
                        <DefaultLeagueToggle
                          key={`${league.id}:${defaultLeagueId === league.id}`}
                          leagueId={league.id}
                          isDefault={defaultLeagueId === league.id}
                        />
                      </div>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>

        {pastLeagues.length > 0 ? (
          <details className="brand-card mt-7 p-4 sm:p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
              <div>
                <p className="brand-eyebrow">Read-only history</p>
                <h2 className="mt-1 text-2xl font-black">Past seasons</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Completed seasons are preserved. These leagues are not
                  currently open for active play.
                </p>
              </div>
              <span className="brand-pill shrink-0">
                {pastLeagues.length} {pastLeagues.length === 1 ? "league" : "leagues"} ▾
              </span>
            </summary>

            <div className="mt-5 space-y-4 border-t border-white/10 pt-5">
              {pastLeagues.map((league) => {
                const summary = summariesByLeague.get(league.id);
                const archivedSeason = summary?.archivedSeason;
                const historyDestination = archivedSeason
                  ? `/leaderboard?season=${archivedSeason.id}`
                  : null;

                return (
                  <article
                    key={league.id}
                    className="brand-card-soft p-4 sm:p-5"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-black">{league.name}</h3>
                          <span className="brand-pill text-slate-300">
                            Season archived
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-slate-300">
                          {archivedSeason
                            ? `${archivedSeason.name} · Final standings available`
                            : "This league is between seasons"}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="brand-pill">
                            {league.role === "league_admin"
                              ? "Owner / Admin"
                              : "Player"}
                          </span>
                          <span className="brand-pill">
                            {summary?.memberCount ?? 0}{" "}
                            {(summary?.memberCount ?? 0) === 1
                              ? "member"
                              : "members"}
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col gap-2 sm:w-48">
                        {historyDestination ? (
                          <PendingLeagueLink
                            href={`/leagues/select?league=${league.id}&next=${encodeURIComponent(
                              historyDestination,
                            )}`}
                            idleLabel="View history"
                            pendingLabel="Opening history..."
                            className="brand-button-secondary w-full"
                          />
                        ) : (
                          <span className="brand-button-secondary cursor-not-allowed text-center opacity-60">
                            No public archive
                          </span>
                        )}
                        {league.role === "league_admin" ||
                        profile?.role === "admin" ? (
                          <PendingLeagueLink
                            href={`/league/settings?league=${league.id}`}
                            idleLabel="League details"
                            pendingLabel="Opening..."
                            className="brand-button-secondary w-full"
                          />
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </details>
        ) : null}
    </div>
  );
}
