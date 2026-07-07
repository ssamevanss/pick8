import type { LeaderboardSummary } from "@/components/predictions/types";
import RankMedal from "@/components/leaderboard/RankMedal";

type DashboardSummaryProps = {
  leaderboardEntry: LeaderboardSummary;
  jokersLeft: number;
  currentGameweekLabel?: string;
  showWeeklyPoints?: boolean;
};

export default function DashboardSummary({
  leaderboardEntry,
  jokersLeft,
  currentGameweekLabel,
  showWeeklyPoints = false,
}: DashboardSummaryProps) {
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
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
            GW points
          </p>
          <p className="mt-1 text-xl font-black text-white sm:mt-2 sm:text-2xl">
            {leaderboardEntry?.weekly_points ?? 0}
          </p>
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
