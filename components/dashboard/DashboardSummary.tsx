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
    <section className="grid gap-4 md:grid-cols-3">
      <div className="rounded-2xl bg-slate-900 p-4 shadow-lg">
        <p className="text-sm text-slate-400">Your rank</p>
        <p className="mt-2 text-3xl font-bold">
          {leaderboardEntry?.rank ? `${leaderboardEntry.rank}` : "-"}
        </p>
      </div>

      <div className="rounded-2xl bg-slate-900 p-4 shadow-lg">
        <p className="text-sm text-slate-400">Total points</p>
        <p className="mt-2 text-3xl font-bold">
          {leaderboardEntry?.total_points ?? 0}
        </p>
      </div>

      <div className="rounded-2xl bg-slate-900 p-4 shadow-lg">
        <p className="text-sm text-slate-400">Jokers left</p>
        <p className="mt-2 text-3xl font-bold">{jokersLeft}</p>
      </div>
    </section>
  );
}