import type { LeaderboardSummary } from "@/components/predictions/types";

type DashboardSummaryProps = {
  leaderboardEntry: LeaderboardSummary;
  jokersLeft: number;
};

export default function DashboardSummary({
  leaderboardEntry,
  jokersLeft,
}: DashboardSummaryProps) {
  return (
    <section className="grid grid-cols-3 gap-2 sm:gap-4">
      <div className="min-w-0 rounded-xl bg-slate-900 p-3 shadow-lg sm:rounded-2xl sm:p-4">
        <p className="truncate text-[11px] text-slate-400 sm:text-sm">
          Your rank
        </p>
        <p className="mt-1 text-xl font-bold sm:mt-2 sm:text-3xl">
          {leaderboardEntry?.rank ? `${leaderboardEntry.rank}` : "-"}
        </p>
      </div>

      <div className="min-w-0 rounded-xl bg-slate-900 p-3 shadow-lg sm:rounded-2xl sm:p-4">
        <p className="truncate text-[11px] text-slate-400 sm:text-sm">
          Total points
        </p>
        <p className="mt-1 text-xl font-bold sm:mt-2 sm:text-3xl">
          {leaderboardEntry?.total_points ?? 0}
        </p>
      </div>

      <div className="min-w-0 rounded-xl bg-slate-900 p-3 shadow-lg sm:rounded-2xl sm:p-4">
        <p className="truncate text-[11px] text-slate-400 sm:text-sm">
          Jokers left
        </p>
        <p className="mt-1 text-xl font-bold sm:mt-2 sm:text-3xl">
          {jokersLeft}
        </p>
      </div>
    </section>
  );
}
