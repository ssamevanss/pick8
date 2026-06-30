"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Gameweek } from "@/components/predictions/types";

type GameweekSelectorProps = {
  gameweeks: Gameweek[];
  selectedGameweekId: string | null;
  basePath: string;
};

function getGameweekLabel(gameweek: Gameweek | undefined) {
  if (!gameweek) return "No gameweek selected";

  return gameweek.name || `Gameweek ${gameweek.gameweek_number}`;
}

function getGameweekHref(basePath: string, gameweekId: string) {
  const separator = basePath.includes("?") ? "&" : "?";
  return `${basePath}${separator}gameweek=${gameweekId}`;
}

export default function GameweekSelector({
  gameweeks,
  selectedGameweekId,
  basePath,
}: GameweekSelectorProps) {
  const router = useRouter();

  const selectedIndex = gameweeks.findIndex(
    (gameweek) => gameweek.id === selectedGameweekId,
  );

  const selectedGameweek =
    selectedIndex >= 0 ? gameweeks[selectedIndex] : undefined;

  const previousGameweek =
    selectedIndex > 0 ? gameweeks[selectedIndex - 1] : null;

  const nextGameweek =
    selectedIndex >= 0 && selectedIndex < gameweeks.length - 1
      ? gameweeks[selectedIndex + 1]
      : null;

  function handleGameweekChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const gameweekId = event.target.value;

    if (!gameweekId) return;

    router.push(getGameweekHref(basePath, gameweekId));
  }

  return (
    <div className="mb-4 grid grid-cols-[40px_minmax(0,1fr)_40px] items-center rounded-2xl bg-slate-950 p-2 ring-1 ring-slate-800 sm:grid-cols-[48px_minmax(0,1fr)_48px]">
      {previousGameweek ? (
        <Link
          href={getGameweekHref(basePath, previousGameweek.id)}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-slate-200 sm:h-10 sm:w-10"
          aria-label="Previous gameweek"
        >
          ←
        </Link>
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-slate-700 sm:h-10 sm:w-10">
          ←
        </span>
      )}

      <div className="min-w-0 px-2 text-center">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Selected gameweek
        </p>

        {gameweeks.length > 0 ? (
          <select
            value={selectedGameweek?.id ?? ""}
            onChange={handleGameweekChange}
            className="mt-1 max-w-full cursor-pointer appearance-none rounded-lg bg-slate-950 px-2 py-1 text-center text-sm font-semibold text-white outline-none ring-1 ring-transparent hover:bg-slate-900 focus:ring-emerald-500 sm:px-3 sm:text-base"
            aria-label="Select gameweek"
          >
            {gameweeks.map((gameweek) => (
              <option key={gameweek.id} value={gameweek.id}>
                {getGameweekLabel(gameweek)}
              </option>
            ))}
          </select>
        ) : (
          <p className="font-semibold text-white">No gameweeks</p>
        )}
      </div>

      {nextGameweek ? (
        <Link
          href={getGameweekHref(basePath, nextGameweek.id)}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-slate-200 sm:h-10 sm:w-10"
          aria-label="Next gameweek"
        >
          →
        </Link>
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-slate-700 sm:h-10 sm:w-10">
          →
        </span>
      )}
    </div>
  );
}
