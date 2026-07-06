import type { LeaderboardSummary } from "@/components/predictions/types";

type DashboardSummaryProps = {
  leaderboardEntry: LeaderboardSummary;
  jokersLeft: number;
  currentGameweekLabel?: string;
};

function getRankMedal(rank: number | null | undefined) {
  if (rank === 1) return { label: "Gold", className: "bg-amber-300 text-slate-950" };
  if (rank === 2) return { label: "Silver", className: "bg-slate-200 text-slate-950" };
  if (rank === 3) return { label: "Bronze", className: "bg-amber-700 text-amber-50" };
  return null;
}

export default function DashboardSummary({
  leaderboardEntry,
  jokersLeft,
  currentGameweekLabel,
}: DashboardSummaryProps) {
  const medal = getRankMedal(leaderboardEntry?.rank);
  const gridColumns = currentGameweekLabel ? "lg:grid-cols-4" : "sm:grid-cols-3";

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
          {medal ? (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${medal.className}`}
              aria-label={`${medal.label} rank`}
              title={`${medal.label} rank`}
            >
              {leaderboardEntry?.rank === 1
                ? "Gold"
                : leaderboardEntry?.rank === 2
                  ? "Silver"
                  : "Bronze"}
            </span>
          ) : null}
        </div>
      </div>

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
