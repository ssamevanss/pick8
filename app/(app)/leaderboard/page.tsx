export const dynamic = "force-dynamic";

import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getActiveSeason } from "@/utils/seasons";

type SearchParams = Promise<{
  season?: string;
}>;

type LeaderboardPageProps = {
  searchParams: SearchParams;
};

type SeasonRow = {
  id: string;
  name: string;
  status: "draft" | "active" | "archived";
  show_in_archive: boolean;
  archived_at: string | null;
};

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

function getMovement(entry: LeaderboardEntry, isArchivedSeason: boolean) {
  if (isArchivedSeason) {
    return "Final";
  }

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

function getMovementClass(entry: LeaderboardEntry, isArchivedSeason: boolean) {
  if (isArchivedSeason) {
    return "text-slate-500";
  }

  if (!entry.rank || !entry.previous_rank || entry.rank === entry.previous_rank) {
    return "text-slate-500";
  }

  if (entry.rank < entry.previous_rank) {
    return "text-emerald-300";
  }

  return "text-red-300";
}

function formatArchiveDate(value: string | null) {
  if (!value) {
    return "Archived";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default async function LeaderboardPage({
  searchParams,
}: LeaderboardPageProps) {
  const resolvedSearchParams = await searchParams;
  const selectedArchivedSeasonId = resolvedSearchParams.season ?? null;

  const supabase = await createClient();

  const { data: activeSeason } = await getActiveSeason(
    supabase,
    "id, name, status, show_in_archive, archived_at",
  );

  const { data: archivedSeasons } = await supabase
    .from("seasons")
    .select("id, name, status, show_in_archive, archived_at")
    .eq("status", "archived")
    .eq("show_in_archive", true)
    .order("archived_at", { ascending: false });

  const archivedSeasonList = (archivedSeasons as SeasonRow[] | null) ?? [];

  const selectedArchivedSeason =
    archivedSeasonList.find(
      (season) => season.id === selectedArchivedSeasonId,
    ) ?? null;

  const selectedSeason = selectedArchivedSeason ?? activeSeason;
  const isArchivedSeason = selectedSeason?.status === "archived";

  const { data: leaderboardEntries, error } = selectedSeason
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
        .eq("season_id", selectedSeason.id)
        .order("rank", { ascending: true })
    : { data: null, error: null };

  const entries = (leaderboardEntries as LeaderboardEntry[] | null) ?? [];

  return (
    <>
      <header className="brand-card mb-6 p-5 sm:p-6">
        <p className="brand-eyebrow">Table talk</p>
        <h1 className="brand-title mt-2">Leaderboard</h1>

        <p className="brand-subtitle mt-2">
          {selectedSeason?.name ?? "No active season"}
          {isArchivedSeason ? " · Final standings" : " · Current season"}
        </p>

        <details className="mt-5 max-w-sm rounded-2xl border border-white/10 bg-slate-950/70 p-2">
          <summary className="list-none cursor-pointer px-3 py-2 text-center [&::-webkit-details-marker]:hidden">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Selected season
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-white sm:text-base">
              {selectedSeason?.name ?? "No season selected"}
            </p>
          </summary>

          <div className="mt-2 space-y-2 border-t border-slate-800 pt-2">
            <Link
              href="/leaderboard"
              prefetch={false}
              className={`block rounded-lg px-3 py-2 text-center text-sm font-semibold ${
                !selectedArchivedSeason
                  ? "bg-emerald-400 text-slate-950"
                  : "bg-slate-900/80 text-slate-300 hover:text-white"
              }`}
            >
              Current season
            </Link>

            {archivedSeasonList.map((season) => (
              <Link
                key={season.id}
                href={`/leaderboard?season=${season.id}`}
                prefetch={false}
                className={`block rounded-lg px-3 py-2 text-center text-sm ${
                  selectedArchivedSeason?.id === season.id
                    ? "bg-emerald-400 text-slate-950"
                    : "bg-slate-900/80 text-slate-300 hover:text-white"
                }`}
              >
                <span className="block truncate font-semibold">
                  {season.name}
                </span>
                <span className="text-xs opacity-80">
                  {formatArchiveDate(season.archived_at)}
                </span>
              </Link>
            ))}
          </div>
        </details>
      </header>

      {selectedArchivedSeasonId && !selectedArchivedSeason ? (
        <p className="brand-alert-warning mt-4">
          That previous season is not available. It may be hidden, deleted, or
          not archived for public leaderboard viewing.
        </p>
      ) : null}

      <section className="brand-card p-4 sm:p-5">
        {error ? (
          <p className="brand-alert-danger">
            {error.message}
          </p>
        ) : null}

        {!error && entries.length === 0 ? (
          <p className="brand-card-soft p-4 text-sm text-slate-400">
            {selectedSeason
              ? "No leaderboard entries yet. Standings will appear after results are saved."
              : "No leaderboard is available until an active season exists."}
          </p>
        ) : null}

        {entries.length > 0 ? (
          <div className="brand-table">
            <div className="hidden grid-cols-[70px_1fr_100px_100px_100px_100px] gap-3 border-b border-white/10 bg-slate-950/90 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid">
              <span>Rank</span>
              <span>Player</span>
              <span className="text-right">Points</span>
              <span className="text-right">Exact</span>
              <span className="text-right">Results</span>
              <span className="text-right">
                {isArchivedSeason ? "Status" : "Move"}
              </span>
            </div>

            <div className="divide-y divide-white/10">
              {entries.map((entry) => (
                <div
                  key={`${entry.rank}-${getDisplayName(entry)}`}
                  className="bg-slate-950/70 px-3 py-3 md:grid md:grid-cols-[70px_1fr_100px_100px_100px_100px] md:items-center md:gap-3 md:px-4 md:py-4"
                >
                  <div className="flex items-center justify-between gap-3 md:block">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-900 text-lg font-black text-white ring-1 ring-white/10 md:h-auto md:w-auto md:bg-transparent md:ring-0">
                      {entry.rank ?? "-"}
                    </span>
                    <div className="min-w-0 flex-1 md:hidden">
                      <p className="truncate font-bold">{getDisplayName(entry)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {entry.exact_scores} exact · {entry.correct_results} results
                      </p>
                    </div>
                    <div className="text-right md:hidden">
                      <p className="text-2xl font-black text-emerald-300">
                        {entry.total_points}
                      </p>
                      <p
                        className={`text-xs font-bold ${getMovementClass(
                          entry,
                          isArchivedSeason,
                        )}`}
                      >
                        {isArchivedSeason ? "Final" : getMovement(entry, false)}
                      </p>
                    </div>
                  </div>

                  <p className="hidden font-semibold md:block">
                    {getDisplayName(entry)}
                  </p>

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
                      isArchivedSeason,
                    )}`}
                  >
                    {getMovement(entry, isArchivedSeason)}
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
