import Link from "next/link";
import SubmitButton from "@/components/forms/SubmitButton";

export type PlatformLeagueOverviewRow = {
  id: string;
  name: string;
  competition: string | null;
  activeSeason: string | null;
  activeMembers: number;
  leagueAdmins: number;
  seasonCount: number;
  archivedSeasonCount: number;
  status: string;
};

export type PlatformSeasonOverviewRow = {
  id: string;
  leagueId: string | null;
  leagueName: string;
  name: string;
  competition: string | null;
  status: string;
  gameweekCount: number;
  activeMembers: number;
  latestCompletedGameweek: string | null;
  resultSyncEnabled: boolean;
  fixtureImportEnabled: boolean;
};

type PlatformAdminOverviewProps = {
  view: "overview" | "leagues" | "seasons";
  counts: {
    approvedUsers: number;
    pendingUsers: number;
    disabledUsers: number;
    activeLeagues: number;
    activeSeasons: number;
    leaguesWithoutActiveSeason: number;
    upcomingUnpickedGameweeks: number;
    openBugReports: number | null;
  };
  leagues: PlatformLeagueOverviewRow[];
  seasons: PlatformSeasonOverviewRow[];
  archiveSeasonAction: (formData: FormData) => Promise<void>;
  archiveReturnTo?: "overview" | "season";
};

function statusClasses(status: string) {
  if (status === "active" || status === "approved") {
    return "bg-emerald-400/10 text-emerald-200";
  }

  if (status === "draft" || status === "pending") {
    return "bg-amber-300/10 text-amber-200";
  }

  return "bg-slate-400/10 text-slate-300";
}

function booleanLabel(value: boolean) {
  return value ? "On" : "Off";
}

export default function PlatformAdminOverview({
  view,
  counts,
  leagues,
  seasons,
  archiveSeasonAction,
  archiveReturnTo = "overview",
}: PlatformAdminOverviewProps) {
  const metrics = [
    ["Approved users", counts.approvedUsers],
    ["Pending users", counts.pendingUsers],
    ["Disabled users", counts.disabledUsers],
    ["Active leagues", counts.activeLeagues],
    ["Active seasons", counts.activeSeasons],
    ["Leagues without an active season", counts.leaguesWithoutActiveSeason],
    ["Upcoming unpicked gameweeks", counts.upcomingUnpickedGameweeks],
    ["Open bug reports", counts.openBugReports ?? "Not available"],
  ] as const;

  return (
    <div className="mt-6 space-y-6">
      {view === "overview" ? (
        <>
        <section className="brand-card p-4 sm:p-5">
        <div className="brand-section-header">
          <p className="brand-eyebrow">Platform overview</p>
          <h2 className="text-2xl font-black tracking-tight">Global status</h2>
          <p className="brand-subtitle">
            Account and league health across the whole app. Operational fixture
            tools in the other tabs remain scoped to the currently selected
            league.
          </p>
        </div>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map(([label, value]) => (
            <div key={label} className="brand-card-soft p-3">
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                {label}
              </dt>
              <dd className="mt-1 text-xl font-black text-white">{value}</dd>
            </div>
          ))}
        </dl>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="brand-card p-4 sm:p-5">
            <p className="brand-eyebrow">Long-running group</p>
            <h2 className="mt-1 text-xl font-black">League</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Owns its name, members, league admins, invites, status, and
              historical seasons. A league continues when one season ends.
            </p>
            <Link
              href="/admin?tab=leagues"
              className="mt-4 inline-flex text-sm font-bold text-emerald-300 hover:text-emerald-200"
            >
              View all leagues →
            </Link>
          </div>
          <div className="brand-card p-4 sm:p-5">
            <p className="brand-eyebrow">Competition period</p>
            <h2 className="mt-1 text-xl font-black">Season</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Belongs to one league and owns its provider setup, gameweeks,
              fixtures, predictions, leaderboard, and active or archived
              status. Each league has at most one active season.
            </p>
            <Link
              href="/admin?tab=seasons"
              className="mt-4 inline-flex text-sm font-bold text-emerald-300 hover:text-emerald-200"
            >
              View all seasons →
            </Link>
          </div>
        </section>
        </>
      ) : null}

      {view === "leagues" ? (
      <section className="brand-card overflow-hidden p-4 sm:p-5">
        <div className="brand-section-header">
          <p className="brand-eyebrow">All leagues</p>
          <h2 className="text-2xl font-black tracking-tight">League summary</h2>
          <p className="brand-subtitle">
            Leagues own membership and invite administration. Seasons are the
            playable competition periods inside them.
          </p>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-[1040px] w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr className="border-b border-white/10">
                <th className="px-3 py-3">League</th>
                <th className="px-3 py-3">Competition</th>
                <th className="px-3 py-3">Active season</th>
                <th className="px-3 py-3">Members</th>
                <th className="px-3 py-3">Admins</th>
                <th className="px-3 py-3">Past seasons</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3 text-right">Manage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {leagues.map((league) => (
                <tr key={league.id} className="text-slate-300">
                  <td className="px-3 py-3 font-bold text-white">{league.name}</td>
                  <td className="px-3 py-3">{league.competition ?? "Not set"}</td>
                  <td className="px-3 py-3">
                    {league.activeSeason ?? "No active season"}
                  </td>
                  <td className="px-3 py-3">{league.activeMembers}</td>
                  <td className="px-3 py-3">{league.leagueAdmins}</td>
                  <td className="px-3 py-3">
                    {league.archivedSeasonCount} archived / {league.seasonCount} total
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-bold capitalize ${statusClasses(
                        league.status,
                      )}`}
                    >
                      {league.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Link
                      href={`/league/settings?league=${league.id}`}
                      className="text-sm font-bold text-emerald-300 hover:text-emerald-200"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {leagues.length === 0 ? (
          <p className="brand-card-soft mt-4 p-4 text-sm text-slate-400">
            No leagues found.
          </p>
        ) : null}
      </section>
      ) : null}

      {view === "seasons" ? (
      <section className="brand-card overflow-hidden p-4 sm:p-5">
        <div className="brand-section-header">
          <p className="brand-eyebrow">All seasons</p>
          <h2 className="text-2xl font-black tracking-tight">Season summary</h2>
          <p className="brand-subtitle">
            Every season belongs to one league. Archive ends active play but
            preserves fixtures, predictions, standings, and history.
          </p>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-[1180px] w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr className="border-b border-white/10">
                <th className="px-3 py-3">League</th>
                <th className="px-3 py-3">Season</th>
                <th className="px-3 py-3">Competition</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Members</th>
                <th className="px-3 py-3">Latest completed</th>
                <th className="px-3 py-3">Gameweeks</th>
                <th className="px-3 py-3">Fixture import</th>
                <th className="px-3 py-3">Result sync</th>
                <th className="px-3 py-3">Archive</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {seasons.map((season) => (
                <tr key={season.id} className="text-slate-300">
                  <td className="px-3 py-3 font-semibold text-white">
                    {season.leagueName}
                  </td>
                  <td className="px-3 py-3">{season.name}</td>
                  <td className="px-3 py-3">{season.competition ?? "Not set"}</td>
                  <td className="px-3 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-bold capitalize ${statusClasses(
                        season.status,
                      )}`}
                    >
                      {season.status}
                    </span>
                  </td>
                  <td className="px-3 py-3">{season.activeMembers}</td>
                  <td className="px-3 py-3">
                    {season.latestCompletedGameweek ?? "None"}
                  </td>
                  <td className="px-3 py-3">{season.gameweekCount}</td>
                  <td className="px-3 py-3">
                    {booleanLabel(season.fixtureImportEnabled)}
                  </td>
                  <td className="px-3 py-3">
                    {booleanLabel(season.resultSyncEnabled)}
                  </td>
                  <td className="px-3 py-3">
                    {season.status !== "archived" ? (
                      <details className="w-64 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3">
                        <summary className="cursor-pointer text-sm font-bold text-amber-200">
                          Archive season
                        </summary>
                        <form action={archiveSeasonAction} className="mt-3">
                          <input
                            type="hidden"
                            name="season_id"
                            value={season.id}
                          />
                          <input
                            type="hidden"
                            name="return_to"
                            value={archiveReturnTo}
                          />
                          <p className="text-xs leading-relaxed text-slate-300">
                            This will make the season read-only and remove it
                            from active play. Historical results remain
                            available.
                          </p>
                          <label className="mt-3 flex items-start gap-2 text-xs text-slate-300">
                            <input
                              type="checkbox"
                              name="confirm_archive"
                              required
                              className="mt-0.5 accent-amber-300"
                            />
                            <span>I understand and want to archive it.</span>
                          </label>
                          <SubmitButton
                            idleLabel="Archive season"
                            pendingLabel="Archiving..."
                            className="mt-3 w-full rounded-lg bg-amber-300 px-3 py-2 text-xs font-black text-slate-950"
                          />
                        </form>
                      </details>
                    ) : (
                      <span className="text-xs font-semibold text-slate-500">
                        Season archived
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {seasons.length === 0 ? (
          <p className="brand-card-soft mt-4 p-4 text-sm text-slate-400">
            No seasons found.
          </p>
        ) : null}
      </section>
      ) : null}
    </div>
  );
}
