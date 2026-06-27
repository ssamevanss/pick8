import { createClient } from "@/utils/supabase/server";

type LeaderboardEntry = {
  rank: number | null;
  previous_rank: number | null;
  total_points: number;
  weekly_points: number;
  exact_scores: number;
  correct_results: number;
  profiles:
    | {
        display_name: string;
      }
    | {
        display_name: string;
      }[]
    | null;
};

function getDisplayName(entry: LeaderboardEntry) {
  if (Array.isArray(entry.profiles)) {
    return entry.profiles[0]?.display_name ?? "Unknown player";
  }

  return entry.profiles?.display_name ?? "Unknown player";
}

function getMovement(entry: LeaderboardEntry) {
  if (!entry.rank || !entry.previous_rank) {
    return "-";
  }

  if (entry.rank < entry.previous_rank) {
    return `▲ ${entry.previous_rank - entry.rank}`;
  }

  if (entry.rank > entry.previous_rank) {
    return `▼ ${entry.rank - entry.previous_rank}`;
  }

  return "–";
}

function getMovementClass(entry: LeaderboardEntry) {
  if (!entry.rank || !entry.previous_rank || entry.rank === entry.previous_rank) {
    return "text-slate-500";
  }

  if (entry.rank < entry.previous_rank) {
    return "text-emerald-300";
  }

  return "text-red-300";
}

export default async function LeaderboardPage() {
  const supabase = await createClient();

  const { data: activeSeason } = await supabase
    .from("seasons")
    .select("id, name")
    .eq("is_active", true)
    .single();

  const { data: leaderboardEntries, error } = activeSeason
    ? await supabase
        .from("leaderboard_entries")
        .select(
          `
          rank,
          previous_rank,
          total_points,
          weekly_points,
          exact_scores,
          correct_results,
          profiles (
            display_name
          )
        `,
        )
        .eq("season_id", activeSeason.id)
        .order("rank", { ascending: true })
    : { data: null, error: null };

  const entries = (leaderboardEntries as LeaderboardEntry[] | null) ?? [];

  return (
    <>
      <h1 className="text-3xl font-bold">Leaderboard</h1>

      <p className="mt-2 text-sm text-slate-400">
        {activeSeason?.name ?? "No active season"}
      </p>

      <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
        {error ? (
          <p className="rounded-xl bg-red-950 p-4 text-sm text-red-300">
            {error.message}
          </p>
        ) : null}

        {!error && entries.length === 0 ? (
          <p className="rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
            No leaderboard entries yet.
          </p>
        ) : null}

        {entries.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <div className="hidden grid-cols-[70px_1fr_100px_100px_100px_100px] gap-3 border-b border-slate-800 bg-slate-950 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid">
              <span>Rank</span>
              <span>Player</span>
              <span className="text-right">Points</span>
              <span className="text-right">Exact</span>
              <span className="text-right">Results</span>
              <span className="text-right">Move</span>
            </div>

            <div className="divide-y divide-slate-800">
              {entries.map((entry) => (
                <div
                  key={`${entry.rank}-${getDisplayName(entry)}`}
                  className="grid gap-2 bg-slate-950 px-4 py-4 md:grid-cols-[70px_1fr_100px_100px_100px_100px] md:items-center md:gap-3"
                >
                  <div className="flex items-center justify-between md:block">
                    <span className="text-xs text-slate-500 md:hidden">
                      Rank
                    </span>
                    <span className="text-lg font-bold">
                      {entry.rank ?? "-"}
                    </span>
                  </div>

                  <div>
                    <p className="font-semibold">{getDisplayName(entry)}</p>
                    <p className="text-xs text-slate-500 md:hidden">
                      {entry.total_points} pts · {entry.exact_scores} exact ·{" "}
                      {entry.correct_results} results
                    </p>
                  </div>

                  <div className="hidden text-right font-semibold md:block">
                    {entry.total_points}
                  </div>

                  <div className="hidden text-right md:block">
                    {entry.exact_scores}
                  </div>

                  <div className="hidden text-right md:block">
                    {entry.correct_results}
                  </div>

                  <div
                    className={`hidden text-right font-semibold md:block ${getMovementClass(
                      entry,
                    )}`}
                  >
                    {getMovement(entry)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}