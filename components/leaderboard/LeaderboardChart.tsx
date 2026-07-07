"use client";

import { useEffect, useState } from "react";

type LeaderboardChartPoint = {
  gameweekNumber: number;
  points: number;
};

export type LeaderboardChartPlayer = {
  userId: string;
  name: string;
  rank: number | null;
  totalPoints: number;
  points: LeaderboardChartPoint[];
};

type LeaderboardChartProps = {
  players: LeaderboardChartPlayer[];
  gameweekNumbers: number[];
};

const lineColours = [
  "#34d399",
  "#fbbf24",
  "#60a5fa",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
  "#2dd4bf",
  "#f97316",
  "#c084fc",
  "#93c5fd",
  "#bef264",
  "#fda4af",
];

function buildPath({
  points,
  gameweekNumbers,
  maxPoints,
  width,
  height,
  paddingX,
  paddingY,
}: {
  points: LeaderboardChartPoint[];
  gameweekNumbers: number[];
  maxPoints: number;
  width: number;
  height: number;
  paddingX: number;
  paddingY: number;
}) {
  const pointMap = new Map(
    points.map((point) => [point.gameweekNumber, point.points]),
  );
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY * 2;
  const xStep =
    gameweekNumbers.length > 1 ? chartWidth / (gameweekNumbers.length - 1) : 0;

  return gameweekNumbers
    .map((gameweekNumber, index) => {
      const x = paddingX + xStep * index;
      const y =
        paddingY +
        chartHeight -
        ((pointMap.get(gameweekNumber) ?? 0) / maxPoints) * chartHeight;

      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function getLatestPoint(points: LeaderboardChartPoint[]) {
  return points[points.length - 1] ?? null;
}

export default function LeaderboardChart({
  players,
  gameweekNumbers,
}: LeaderboardChartProps) {
  const [visiblePlayerIds, setVisiblePlayerIds] = useState<Set<string>>(
    () => new Set(players.map((player) => player.userId)),
  );
  const [frameIndex, setFrameIndex] = useState(() =>
    Math.max(0, gameweekNumbers.length - 1),
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const lastFrameIndex = Math.max(0, gameweekNumbers.length - 1);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const interval = window.setInterval(() => {
      setFrameIndex((current) => {
        if (current >= lastFrameIndex) {
          setIsPlaying(false);
          return current;
        }

        return current + 1;
      });
    }, 750);

    return () => window.clearInterval(interval);
  }, [isPlaying, lastFrameIndex]);

  if (players.length === 0 || gameweekNumbers.length === 0) {
    return (
      <div className="brand-card-soft p-4 text-sm text-slate-400">
        No chart data yet. The points race will appear once gameweeks and
        scored predictions are available.
      </div>
    );
  }

  const displayedGameweekNumbers = gameweekNumbers.slice(0, frameIndex + 1);
  const visiblePlayers = players.filter((player) =>
    visiblePlayerIds.has(player.userId),
  );
  const width = Math.max(720, gameweekNumbers.length * 52);
  const height = 380;
  const paddingX = 56;
  const paddingY = 38;
  const maxPoints = Math.max(
    5,
    ...players.flatMap((player) => player.points.map((point) => point.points)),
  );
  const roundedMax = Math.ceil(maxPoints / 10) * 10 || 10;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) =>
    Math.round(roundedMax * ratio),
  );
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY * 2;
  const xStep =
    displayedGameweekNumbers.length > 1
      ? chartWidth / (displayedGameweekNumbers.length - 1)
      : 0;

  function togglePlayer(userId: string) {
    setVisiblePlayerIds((current) => {
      const next = new Set(current);

      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }

      return next;
    });
  }

  function handlePlayPause() {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }

    if (frameIndex >= lastFrameIndex) {
      setFrameIndex(0);
    }

    setIsPlaying(true);
  }

  function handleReset() {
    setIsPlaying(false);
    setFrameIndex(0);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-black text-white">Points race</h2>
          <p className="mt-1 text-sm text-slate-400">
            Cumulative season points by gameweek.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handlePlayPause}
          className="inline-flex min-h-9 items-center rounded-full border border-white/10 bg-slate-950/70 px-3 text-xs font-black uppercase tracking-wide text-slate-200 transition hover:border-emerald-300/40 hover:text-white"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="inline-flex min-h-9 items-center rounded-full border border-white/10 bg-slate-950/70 px-3 text-xs font-black uppercase tracking-wide text-slate-400 transition hover:border-white/20 hover:text-white"
        >
          Reset
        </button>
        <span className="text-xs font-semibold text-slate-500">
          GW{displayedGameweekNumbers[0]} to GW
          {displayedGameweekNumbers[displayedGameweekNumbers.length - 1]}
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/70 p-3">
        <svg
          role="img"
          aria-label="Leaderboard points over time chart"
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          className="max-w-none"
        >
          <rect width={width} height={height} rx="18" fill="#020817" />

          {yTicks.map((tick) => {
            const y =
              paddingY + chartHeight - (tick / roundedMax) * chartHeight;

            return (
              <g key={tick}>
                <line
                  x1={paddingX}
                  x2={width - paddingX}
                  y1={y}
                  y2={y}
                  stroke="rgba(148, 163, 184, 0.16)"
                />
                <text
                  x={paddingX - 14}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-slate-500 text-[11px] font-semibold"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {displayedGameweekNumbers.map((gameweekNumber, index) => {
            const x = paddingX + xStep * index;
            const showLabel =
              displayedGameweekNumbers.length <= 12 ||
              index === 0 ||
              index === displayedGameweekNumbers.length - 1 ||
              index % 3 === 0;

            return (
              <g key={gameweekNumber}>
                <line
                  x1={x}
                  x2={x}
                  y1={paddingY}
                  y2={height - paddingY}
                  stroke="rgba(148, 163, 184, 0.08)"
                />
                {showLabel ? (
                  <text
                    x={x}
                    y={height - 14}
                    textAnchor="middle"
                    className="fill-slate-500 text-[11px] font-semibold"
                  >
                    GW{gameweekNumber}
                  </text>
                ) : null}
              </g>
            );
          })}

          {visiblePlayers.map((player, index) => {
            const originalIndex = players.findIndex(
              (item) => item.userId === player.userId,
            );
            const colour =
              lineColours[
                (originalIndex >= 0 ? originalIndex : index) %
                  lineColours.length
              ];
            const path = buildPath({
              points: player.points,
              gameweekNumbers: displayedGameweekNumbers,
              maxPoints: roundedMax,
              width,
              height,
              paddingX,
              paddingY,
            });
            const latestPoint = getLatestPoint(
              player.points.filter((point) =>
                displayedGameweekNumbers.includes(point.gameweekNumber),
              ),
            );
            const latestIndex = displayedGameweekNumbers.length - 1;
            const labelY = latestPoint
              ? paddingY +
                chartHeight -
                (latestPoint.points / roundedMax) * chartHeight
              : height - paddingY;

            return (
              <g key={player.userId}>
                <path
                  d={path}
                  fill="none"
                  stroke={colour}
                  strokeWidth={originalIndex >= 0 && originalIndex < 3 ? 3 : 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={originalIndex >= 10 ? 0.58 : 0.95}
                />
                <circle
                  cx={paddingX + xStep * latestIndex}
                  cy={labelY}
                  r={originalIndex >= 0 && originalIndex < 3 ? 4 : 3}
                  fill={colour}
                  stroke="#020817"
                  strokeWidth="2"
                />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {players.map((player, index) => {
          const isVisible = visiblePlayerIds.has(player.userId);

          return (
            <button
              key={player.userId}
              type="button"
              onClick={() => togglePlayer(player.userId)}
              className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${
                isVisible
                  ? "border-white/10 bg-slate-950/55"
                  : "border-white/5 bg-slate-950/25 opacity-45"
              }`}
              aria-pressed={isVisible}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: lineColours[index % lineColours.length],
                }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-200">
                {player.name}
              </span>
              <span className="text-sm font-black text-white">
                {player.totalPoints}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
