"use client";

import { useState, useTransition } from "react";
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
  const [isPending, startTransition] = useTransition();
  const [pendingGameweekId, setPendingGameweekId] = useState<string | null>(
    null,
  );

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

    const href = getGameweekHref(basePath, gameweekId);
    setPendingGameweekId(gameweekId);
    startTransition(() => {
      router.push(href);
    });
  }

  function handleArrowClick(
    event: React.MouseEvent<HTMLAnchorElement>,
    href: string,
  ) {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }

    const gameweekId = new URL(href, window.location.href).searchParams.get(
      "gameweek",
    );

    setPendingGameweekId(gameweekId);
  }

  const activePendingGameweekId =
    pendingGameweekId && pendingGameweekId !== selectedGameweekId
      ? pendingGameweekId
      : null;
  const isBusy = isPending || Boolean(activePendingGameweekId);
  const arrowClassName =
    "flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-slate-200 transition hover:text-white active:scale-95 aria-busy:animate-pulse aria-busy:text-emerald-200 sm:h-10 sm:w-10";
  const disabledArrowClassName =
    "flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900/70 text-lg font-bold text-slate-700 sm:h-10 sm:w-10";
  const previousHref = previousGameweek
    ? getGameweekHref(basePath, previousGameweek.id)
    : null;
  const nextHref = nextGameweek
    ? getGameweekHref(basePath, nextGameweek.id)
    : null;

  return (
    <div
      className="mb-4 grid grid-cols-[40px_minmax(0,1fr)_40px] items-center rounded-2xl border border-white/10 bg-slate-950/70 p-2 sm:grid-cols-[48px_minmax(0,1fr)_48px]"
      aria-busy={isBusy}
    >
      {previousGameweek && previousHref ? (
        <Link
          href={previousHref}
          onClick={(event) => {
            handleArrowClick(event, previousHref);
          }}
          className={arrowClassName}
          aria-label="Previous gameweek"
          aria-busy={activePendingGameweekId === previousGameweek.id}
        >
          <span aria-hidden="true">
            {activePendingGameweekId === previousGameweek.id ? "…" : "←"}
          </span>
        </Link>
      ) : (
        <button
          type="button"
          disabled
          className={disabledArrowClassName}
          aria-label="No previous gameweek"
        >
          ←
        </button>
      )}

      <div className="min-w-0 px-2 text-center">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Selected gameweek
        </p>

        {gameweeks.length > 0 ? (
          <select
            value={selectedGameweek?.id ?? ""}
            onChange={handleGameweekChange}
            disabled={isBusy}
            className="mt-1 max-w-full cursor-pointer appearance-none rounded-lg bg-slate-900/70 px-2 py-1 text-center text-sm font-bold text-white outline-none ring-1 ring-transparent hover:bg-slate-900 focus:ring-emerald-400 disabled:cursor-wait disabled:opacity-70 sm:px-3 sm:text-base"
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

      {nextGameweek && nextHref ? (
        <Link
          href={nextHref}
          onClick={(event) => {
            handleArrowClick(event, nextHref);
          }}
          className={arrowClassName}
          aria-label="Next gameweek"
          aria-busy={activePendingGameweekId === nextGameweek.id}
        >
          <span aria-hidden="true">
            {activePendingGameweekId === nextGameweek.id ? "…" : "→"}
          </span>
        </Link>
      ) : (
        <button
          type="button"
          disabled
          className={disabledArrowClassName}
          aria-label="No next gameweek"
        >
          →
        </button>
      )}
    </div>
  );
}
