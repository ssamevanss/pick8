export const dynamic = "force-dynamic";

import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getActiveSeason } from "@/utils/seasons";
import RankMedal from "@/components/leaderboard/RankMedal";
import LeaderboardChart, {
  type LeaderboardChartPlayer,
} from "@/components/leaderboard/LeaderboardChart";

type SearchParams = Promise<{
  players?: string;
  season?: string;
  view?: string;
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
  user_id: string;
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

type GameweekRow = {
  id: string;
  gameweek_number: number;
};

type PredictionPointsRow = {
  user_id: string;
  points: number | null;
  fixtures:
    | {
        gameweeks:
          | {
              id: string;
              gameweek_number: number;
            }
          | {
              id: string;
              gameweek_number: number;
            }[]
          | null;
      }
    | {
        gameweeks:
          | {
              id: string;
              gameweek_number: number;
            }
          | {
              id: string;
              gameweek_number: number;
            }[]
          | null;
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

function RankDisplay({ rank }: { rank: number | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{rank ?? "-"}</span>
      <RankMedal rank={rank} />
    </span>
  );
}

function getGameweekFromPrediction(prediction: PredictionPointsRow) {
  const fixture = Array.isArray(prediction.fixtures)
    ? prediction.fixtures[0]
    : prediction.fixtures;
  const gameweek = Array.isArray(fixture?.gameweeks)
    ? fixture?.gameweeks[0]
    : fixture?.gameweeks;

  return gameweek ?? null;
}

function buildLeaderboardHref({
  seasonId,
  view,
  players,
}: {
  seasonId: string | null;
  view?: "table" | "chart";
  players?: "top" | "all";
}) {
  const params = new URLSearchParams();

  if (seasonId) {
    params.set("season", seasonId);
  }

  if (view && view !== "table") {
    params.set("view", view);
  }

  if (players && players !== "top") {
    params.set("players", players);
  }

  const query = params.toString();

  return query ? `/leaderboard?${query}` : "/leaderboard";
}

function buildChartPlayers({
  entries,
  gameweeks,
  predictionRows,
  showAllPlayers,
}: {
  entries: LeaderboardEntry[];
  gameweeks: GameweekRow[];
  predictionRows: PredictionPointsRow[];
  showAllPlayers: boolean;
}): LeaderboardChartPlayer[] {
  const selectedEntries = showAllPlayers ? entries : entries.slice(0, 10);
  const pointsByUserGameweek = new Map<string, number>();

  for (const prediction of predictionRows) {
    const gameweek = getGameweekFromPrediction(prediction);

    if (!gameweek) {
      continue;
    }

    const key = `${prediction.user_id}:${gameweek.id}`;
    pointsByUserGameweek.set(
      key,
      (pointsByUserGameweek.get(key) ?? 0) + (prediction.points ?? 0),
    );
  }

  return selectedEntries.map((entry) => {
    let runningTotal = 0;

    return {
      userId: entry.user_id,
      name: getDisplayName(entry),
      rank: entry.rank,
      totalPoints: entry.total_points,
      points: gameweeks.map((gameweek) => {
        runningTotal +=
          pointsByUserGameweek.get(`${entry.user_id}:${gameweek.id}`) ?? 0;

        return {
          gameweekNumber: gameweek.gameweek_number,
          points: runningTotal,
        };
      }),
    };
  });
}

export default async function LeaderboardPage({
  searchParams,
}: LeaderboardPageProps) {
  const resolvedSearchParams = await searchParams;
  const selectedArchivedSeasonId = resolvedSearchParams.season ?? null;
  const view = resolvedSearchParams.view === "chart" ? "chart" : "table";
  const showAllPlayers = resolvedSearchParams.players === "all";

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
          user_id,
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
  const { data: gameweekRows } = selectedSeason
    ? await supabase
        .from("gameweeks")
        .select("id, gameweek_number")
        .eq("season_id", selectedSeason.id)
        .order("gameweek_number", { ascending: true })
    : { data: null };
  const gameweeks = (gameweekRows as GameweekRow[] | null) ?? [];
  const { data: predictionPointsRows } = selectedSeason
    ? await supabase
        .from("predictions")
        .select(
          `
          user_id,
          points,
          fixtures!inner (
            status,
            gameweeks!inner (
              id,
              gameweek_number,
              season_id
            )
          )
        `,
        )
        .eq("fixtures.status", "completed")
        .eq("fixtures.gameweeks.season_id", selectedSeason.id)
        .not("points", "is", null)
    : { data: null };
  const predictionRows =
    (predictionPointsRows as PredictionPointsRow[] | null) ?? [];
  const scoredGameweekIds = new Set(
    predictionRows
      .map((prediction) => getGameweekFromPrediction(prediction)?.id)
      .filter((value): value is string => Boolean(value)),
  );
  const scoredGameweeks = gameweeks.filter((gameweek) =>
    scoredGameweekIds.has(gameweek.id),
  );
  const chartPlayers = buildChartPlayers({
    entries,
    gameweeks: scoredGameweeks,
    predictionRows,
    showAllPlayers,
  });
  const gameweekNumbers = scoredGameweeks.map(
    (gameweek) => gameweek.gameweek_number,
  );

  return (
    <>
      <header className="brand-card mb-6 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="brand-eyebrow">Table talk</p>
            <h1 className="brand-title mt-2">Leaderboard</h1>

            <p className="brand-subtitle mt-2">
              {selectedSeason?.name ?? "No active season"}
              {isArchivedSeason ? " · Final standings" : " · Current season"}
            </p>
          </div>

          <details className="relative w-full sm:w-auto">
            <summary className="inline-flex min-h-10 w-full cursor-pointer list-none items-center justify-between gap-2 rounded-full border border-white/10 bg-[#07111f]/75 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-300/40 hover:text-white sm:w-56 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 truncate">
                {selectedArchivedSeason ? "Previous season" : "Current season"}
              </span>
              <span className="text-emerald-300">▾</span>
            </summary>

            <div className="z-20 mt-2 w-full space-y-2 rounded-2xl border border-white/10 bg-[#07111f] p-2 shadow-2xl shadow-black/40 sm:absolute sm:right-0 sm:w-72">
            <Link
              href="/leaderboard"
              prefetch={false}
              className={`block rounded-xl px-3 py-2 text-sm font-semibold ${
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
                className={`block rounded-xl px-3 py-2 text-sm ${
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
        </div>
      </header>

      {selectedArchivedSeasonId && !selectedArchivedSeason ? (
        <p className="brand-alert-warning mt-4">
          That previous season is not available. It may be hidden, deleted, or
          not archived for public leaderboard viewing.
        </p>
      ) : null}

      <section className="brand-card p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-full border border-white/10 bg-slate-950/70 p-1">
            <Link
              href={buildLeaderboardHref({
                seasonId: selectedArchivedSeason?.id ?? null,
                view: "table",
                players: showAllPlayers ? "all" : "top",
              })}
              prefetch={false}
              className={`rounded-full px-4 py-2 text-sm font-black transition ${
                view === "table"
                  ? "bg-emerald-400 text-slate-950"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Table
            </Link>
            <Link
              href={buildLeaderboardHref({
                seasonId: selectedArchivedSeason?.id ?? null,
                view: "chart",
                players: showAllPlayers ? "all" : "top",
              })}
              prefetch={false}
              className={`rounded-full px-4 py-2 text-sm font-black transition ${
                view === "chart"
                  ? "bg-emerald-400 text-slate-950"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Chart
            </Link>
          </div>

          {view === "chart" && entries.length > 10 ? (
            <Link
              href={buildLeaderboardHref({
                seasonId: selectedArchivedSeason?.id ?? null,
                view: "chart",
                players: showAllPlayers ? "top" : "all",
              })}
              prefetch={false}
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-slate-950/70 px-4 text-sm font-bold text-slate-200 transition hover:border-emerald-300/40 hover:text-white"
            >
              {showAllPlayers ? "Show top 10" : "Show all players"}
            </Link>
          ) : null}
        </div>

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

        {entries.length > 0 && view === "chart" ? (
          <LeaderboardChart
            key={`${selectedSeason?.id ?? "none"}-${showAllPlayers ? "all" : "top"}-${gameweekNumbers.join("-")}`}
            players={chartPlayers}
            gameweekNumbers={gameweekNumbers}
            showingAllPlayers={showAllPlayers}
            totalPlayerCount={entries.length}
          />
        ) : null}

        {entries.length > 0 && view === "table" ? (
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
                    <span className="grid h-11 min-w-16 place-items-center rounded-xl bg-slate-900 px-2 text-lg font-black text-white ring-1 ring-white/10 md:h-auto md:min-w-0 md:bg-transparent md:px-0 md:ring-0">
                      <RankDisplay rank={entry.rank} />
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
