"use client";

import Link from "next/link";
import { useState } from "react";
import type { LatestMatchdayWinners, WinnerPick } from "@/utils/pick8-latest-winners";

const RANK_STYLES: Record<number, string> = {
  1: "border-amber-300/50 bg-amber-300/15 text-amber-100",
  2: "border-slate-300/40 bg-slate-300/10 text-slate-100",
  3: "border-orange-300/40 bg-orange-300/10 text-orange-100",
};

const STATE_LABELS: Record<WinnerPick["state"], string> = { correct: "Correct", incorrect: "Incorrect", void: "Void", pending: "Pending" };

function pointsLabel(points: number | null) {
  if (points === null) return "—";
  return points > 0 ? `+${points}` : String(points);
}

function pointsClass(points: number | null) {
  if (points === null) return "border-slate-600/60 bg-slate-800 text-slate-300";
  if (points > 0) return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (points < 0) return "border-rose-400/30 bg-rose-400/10 text-rose-200";
  return "border-amber-300/30 bg-amber-300/10 text-amber-100";
}

export default function MatchdayWinners({ data, currentUserId }: { data: LatestMatchdayWinners; currentUserId: string }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <section className="brand-card p-4 sm:p-5" aria-labelledby="latest-winners-heading">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="brand-eyebrow">Latest results</p>
          <h2 id="latest-winners-heading" className="mt-1 text-xl font-black text-white">Matchday {data.matchdayNumber} winners</h2>
        </div>
        {data.actualGoals !== null ? <span className="brand-pill shrink-0">{data.actualGoals} goals</span> : null}
      </div>
      <ol className="mt-4 space-y-2">
        {data.winners.map((winner) => {
          const open = expanded.has(winner.playerId);
          const panelId = `winner-picks-${winner.playerId}`;
          const isCurrentPlayer = winner.playerId === currentUserId;
          return (
            <li key={winner.playerId} className={`overflow-hidden rounded-xl border ${isCurrentPlayer ? "border-emerald-300/35" : "border-white/10"} bg-[#07111f]/60`}>
              <button
                type="button"
                className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggle(winner.playerId)}
              >
                <span className={`grid h-8 min-w-8 shrink-0 place-items-center rounded-full border px-1 text-xs font-black ${RANK_STYLES[winner.rank] ?? RANK_STYLES[3]}`}>#{winner.rank}</span>
                <span className="min-w-0 flex-1 text-sm font-bold leading-tight text-white [overflow-wrap:anywhere]">
                  {winner.name}{isCurrentPlayer ? <span className="ml-2 text-xs font-bold text-emerald-300">You</span> : null}
                </span>
                <strong className="shrink-0 text-base font-black text-emerald-200">{winner.points}<span className="ml-0.5 text-[10px] font-bold text-slate-400">pts</span></strong>
                <span className={`shrink-0 text-lg text-slate-300 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true">⌄</span>
              </button>
              {open ? (
                <div id={panelId} className="space-y-2 border-t border-white/10 p-3">
                  <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    {winner.complete ? `${winner.picks.length} picks + Total Goals` : `${winner.picks.length} of ${winner.expectedPickCount} picks available`}
                  </p>
                  {winner.picks.length ? winner.picks.map((pick) => (
                    <div key={pick.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 rounded-lg bg-white/[0.03] p-2.5 text-sm">
                      <p className="font-bold leading-tight text-white [overflow-wrap:anywhere]">{pick.label}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-black tabular-nums ${pointsClass(pick.points)}`}>{pointsLabel(pick.points)}</span>
                      <p className="text-xs text-slate-400 [overflow-wrap:anywhere]">{pick.fixture}{pick.result ? ` · ${pick.result}` : ""}</p>
                      <p className={`text-right text-[11px] font-bold ${pick.state === "correct" ? "text-emerald-200" : pick.state === "incorrect" ? "text-rose-200" : "text-slate-400"}`}>{STATE_LABELS[pick.state]}</p>
                    </div>
                  )) : <p className="text-sm text-slate-400">Picks are not available.</p>}
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] p-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="font-bold text-white">Total Goals</p>
                      <p className="text-xs text-slate-400">
                        Predicted {winner.totalGoalsPrediction ?? "—"}{data.actualGoals !== null ? ` · Actual ${data.actualGoals}` : ""}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-black tabular-nums ${pointsClass(winner.totalGoalsPoints)}`}>{pointsLabel(winner.totalGoalsPoints)}</span>
                  </div>
                  {!winner.complete ? <p className="px-0.5 text-xs text-amber-200">Some picks are not available, so Total Goals points are not shown.</p> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {data.hiddenTied > 0 ? <p className="mt-2 text-xs text-slate-400">+{data.hiddenTied} more tied in the top three.</p> : null}
      <Link href={`/tables?view=matchday&matchday=${data.matchdayNumber}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-emerald-200 hover:text-emerald-100">Full matchday breakdown →</Link>
    </section>
  );
}
