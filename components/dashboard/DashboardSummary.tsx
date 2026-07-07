import type { LeaderboardSummary } from "@/components/predictions/types";
import RankMedal from "@/components/leaderboard/RankMedal";

type DashboardSummaryProps = {
  leaderboardEntry: LeaderboardSummary;
  jokersLeft: number;
  currentGameweekLabel?: string;
  showWeeklyPoints?: boolean;
  liveWeeklyPoints?: number | null;
  liveFixtureCount?: number;
};

export default function DashboardSummary({
  leaderboardEntry,
  jokersLeft,
  currentGameweekLabel,
  showWeeklyPoints = false,
  liveWeeklyPoints = null,
  liveFixtureCount = 0,
}: DashboardSummaryProps) {
  const hasLiveWeeklyPoints = liveWeeklyPoints !== null;
  const gridColumns = currentGameweekLabel
    ? "lg:grid-cols-4"
    : showWeeklyPoints
      ? "sm:grid-cols-4"
      : "sm:grid-cols-3";

  return (
    <section className={`mb-5 grid grid-cols-2 gap-2 sm:mb-6 ${gridColumns}`}>
      {currentGameweekLabel ? (
        <div className="brand-card min-w-0 p-3">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
            Current gameweek
          </p>
          <p className="mt-1 truncate text-xl font-black text-white sm:text-2xl">
            {currentGameweekLabel}
          </p>
        </div>
      ) : null}

      <div className="brand-card min-w-0 p-3">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
          Your position
        </p>
        <div className="mt-1 flex items-center gap-2 sm:mt-2">
          <p className="text-xl font-black text-white sm:text-2xl">
            {leaderboardEntry?.rank ? `${leaderboardEntry.rank}` : "-"}
          </p>
          <RankMedal rank={leaderboardEntry?.rank} />
        </div>
      </div>

      {showWeeklyPoints ? (
        <div className="brand-card min-w-0 p-3">
          <div className="flex items-center gap-2">
            <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
              GW points
            </p>
            {hasLiveWeeklyPoints ? (
              <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-200">
                Live
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xl font-black text-white sm:mt-2 sm:text-2xl">
            {hasLiveWeeklyPoints
              ? liveWeeklyPoints
              : leaderboardEntry?.weekly_points ?? 0}
          </p>
          {hasLiveWeeklyPoints ? (
            <p className="mt-1 truncate text-[10px] font-semibold text-slate-500">
              {liveFixtureCount > 0
                ? `${liveFixtureCount} live · official after FT`
                : "Provisional · official after FT"}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="brand-card min-w-0 p-3">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
          Total points
        </p>
        <p className="mt-1 text-xl font-black text-white sm:mt-2 sm:text-2xl">
          {leaderboardEntry?.total_points ?? 0}
        </p>
      </div>

      <div className="brand-card min-w-0 p-3">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
          Jokers remaining
        </p>
        <p className="mt-1 text-xl font-black text-white sm:mt-2 sm:text-2xl">
          {jokersLeft}
        </p>
      </div>
    </section>
  );
}
