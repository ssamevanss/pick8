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
      <div className="brand-card min-w-0 p-3 sm:p-4">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
          Your rank
        </p>
        <p className="mt-1 text-xl font-black text-white sm:mt-2 sm:text-3xl">
          {leaderboardEntry?.rank ? `${leaderboardEntry.rank}` : "-"}
        </p>
      </div>

      <div className="brand-card min-w-0 p-3 sm:p-4">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
          Total points
        </p>
        <p className="mt-1 text-xl font-black text-emerald-300 sm:mt-2 sm:text-3xl">
          {leaderboardEntry?.total_points ?? 0}
        </p>
      </div>

      <div className="brand-card min-w-0 p-3 sm:p-4">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
          Jokers left
        </p>
        <p className="mt-1 text-xl font-black text-amber-300 sm:mt-2 sm:text-3xl">
          {jokersLeft}
        </p>
      </div>
    </section>
  );
}
