"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type LeaderboardViewToggleProps = {
  activeView: "table" | "chart";
  tableHref: string;
  chartHref: string;
};

export default function LeaderboardViewToggle({
  activeView,
  tableHref,
  chartHref,
}: LeaderboardViewToggleProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function navigateToView(view: "table" | "chart", href: string) {
    if (view === activeView || isPending) {
      return;
    }

    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <div
      className="inline-flex w-fit self-start rounded-full border border-white/10 bg-slate-950/70 p-1"
      aria-label="Leaderboard view"
      aria-busy={isPending}
    >
      {(["table", "chart"] as const).map((view) => {
        const isActive = activeView === view;
        const label = view === "table" ? "Table" : "Chart";
        const href = view === "table" ? tableHref : chartHref;

        return (
          <button
            key={view}
            type="button"
            onClick={() => navigateToView(view, href)}
            disabled={isPending || isActive}
            aria-pressed={isActive}
            className={`rounded-full px-4 py-2 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60 disabled:cursor-default ${
              isActive
                ? "bg-emerald-400 text-slate-950 shadow-sm shadow-emerald-950/30"
                : "text-slate-300 hover:text-white disabled:opacity-60"
            } ${isPending && !isActive ? "cursor-wait opacity-70" : ""}`}
          >
            {isPending && !isActive ? `${label}…` : label}
          </button>
        );
      })}
    </div>
  );
}
