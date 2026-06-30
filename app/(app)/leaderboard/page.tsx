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
      <h1 className="text-3xl font-bold">Leaderboard</h1>

      <p className="mt-2 text-sm text-slate-400">
        {selectedSeason?.name ?? "No active season"}
        {isArchivedSeason ? " · Final standings" : ""}
      </p>

      {selectedArchivedSeasonId && !selectedArchivedSeason ? (
        <p className="mt-4 rounded-xl bg-amber-950 p-4 text-sm text-amber-300">
          That previous season is not available. It may be hidden, deleted, or
          not archived for public leaderboard viewing.
        </p>
      ) : null}

      <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold">
              {isArchivedSeason ? "Previous season" : "Current season"}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {!selectedSeason
                ? "No active season has been set up yet."
                : isArchivedSeason
                ? `Archived leaderboard from ${formatArchiveDate(
                    selectedSeason?.archived_at ?? null,
                  )}.`
                : "Live standings for the active season."}
            </p>
          </div>

          <div className="flex flex-col gap-2 md:min-w-64">
            <Link
              href="/leaderboard"
              prefetch={false}
              className={`rounded-lg px-3 py-2 text-center text-sm font-semibold ${
                !selectedArchivedSeason
                  ? "bg-emerald-500 text-slate-950"
                  : "border border-slate-700 text-slate-300"
              }`}
            >
              Current season
            </Link>

            {archivedSeasonList.length > 0 ? (
              <details className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-300">
                  Previous seasons
                </summary>

                <div className="mt-3 space-y-2">
                  {archivedSeasonList.map((season) => (
                    <Link
                      key={season.id}
                      href={`/leaderboard?season=${season.id}`}
                      prefetch={false}
                      className={`block rounded-lg px-3 py-2 text-sm ${
                        selectedArchivedSeason?.id === season.id
                          ? "bg-emerald-500 text-slate-950"
                          : "bg-slate-900 text-slate-300"
                      }`}
                    >
                      <span className="block font-semibold">{season.name}</span>
                      <span className="text-xs opacity-80">
                        {formatArchiveDate(season.archived_at)}
                      </span>
                    </Link>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
        {error ? (
          <p className="rounded-xl bg-red-950 p-4 text-sm text-red-300">
            {error.message}
          </p>
        ) : null}

        {!error && entries.length === 0 ? (
          <p className="rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
            {selectedSeason
              ? "No leaderboard entries yet. Standings will appear after results are saved."
              : "No leaderboard is available until an active season exists."}
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
              <span className="text-right">
                {isArchivedSeason ? "Status" : "Move"}
              </span>
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
                      isArchivedSeason,
                    )}`}
                  >
                    {getMovement(entry, isArchivedSeason)}
                  </div>

                  <div
                    className={`text-sm font-semibold md:hidden ${getMovementClass(
                      entry,
                      isArchivedSeason,
                    )}`}
                  >
                    {isArchivedSeason ? "Final standings" : getMovement(entry, false)}
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
