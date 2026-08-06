"use client";

import { useState } from "react";
import TeamIdentity from "@/components/picks/TeamIdentity";
import {
  PICK_CATEGORY_LABELS,
  type BreakdownFixture,
  type BreakdownMatchday,
  type BreakdownPlayer,
} from "@/utils/pick8-breakdown-types";

function scoreLabel(score: number | null) {
  if (score === null) return "Pending";
  return score > 0 ? `+${score}` : String(score);
}

function scoreClass(score: number | null | undefined) {
  if (score === null || score === undefined) return "border-slate-600/60 bg-slate-800 text-slate-300";
  if (score > 0) return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (score < 0) return "border-rose-400/30 bg-rose-400/10 text-rose-200";
  return "border-amber-300/30 bg-amber-300/10 text-amber-100";
}

function selectionStateClass(state: string) {
  if (state === "Correct") return "text-emerald-200";
  if (state === "Incorrect") return "text-rose-200";
  if (state === "Void") return "text-amber-200";
  return "text-slate-300";
}

export default function ReadOnlyMatchdayPicks({
  matchday,
  fixtures,
  players,
  actualGoals,
  finalReady,
  currentPlayerId,
  showFixtures = true,
}: {
  matchday: BreakdownMatchday;
  fixtures: BreakdownFixture[];
  players: BreakdownPlayer[];
  actualGoals: number | null;
  finalReady: boolean;
  currentPlayerId: string;
  showFixtures?: boolean;
}) {
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const [expandedPlayers, setExpandedPlayers] = useState<Set<string>>(
    () =>
      new Set(
        players
          .filter(
            ({ player }) => players.length === 1 || player.id === currentPlayerId,
          )
          .map(({ player }) => player.id),
      ),
  );

  function togglePlayer(playerId: string) {
    setExpandedPlayers((current) => {
      const next = new Set(current);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      {showFixtures ? (
        <section className="brand-card p-4 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="brand-eyebrow">Matchday {matchday.matchday_number}</p><h2 className="mt-1 text-2xl font-black capitalize text-white">{matchday.status}</h2></div>
            <div className="text-right"><p className="text-xs uppercase tracking-wide text-slate-400">Actual Total Goals</p><p className="text-2xl font-black text-emerald-200">{finalReady ? actualGoals : "Pending"}</p></div>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {fixtures.map((fixture) => <div key={fixture.id} className="brand-card-soft flex items-center justify-between gap-3 p-3 text-sm"><div className="grid min-w-0 gap-1.5"><TeamIdentity name={fixture.home_team_name} crestUrl={fixture.home_team_crest_url} /><TeamIdentity name={fixture.away_team_name} crestUrl={fixture.away_team_crest_url} /><p className="text-xs capitalize text-slate-400">{fixture.status.replaceAll("_", " ")}</p></div><p className="text-lg font-black text-white">{fixture.home_score ?? "–"}–{fixture.away_score ?? "–"}</p></div>)}
          </div>
        </section>
      ) : null}
      <div className="space-y-3">
        {players.map(({ player, entry, selections, totalGoalsPoints }) => {
          const status = !entry ? "No submitted entry" : entry.submitted_at ? (entry.calculated_score === null ? "Submitted · Pending" : "Submitted · Final") : "Draft";
          const expanded = expandedPlayers.has(player.id);
          const panelId = `player-picks-${entry?.id ?? player.id}`;
          const displayName = player.display_name.trim() || "Player";
          return (
            <article key={player.id} className="brand-card overflow-hidden">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 p-4 text-left"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => togglePlayer(player.id)}
              >
                <div className="min-w-0">
                  <p className="truncate font-black text-white">{displayName}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {status}{entry ? ` · Total Goals: ${entry.total_goals_prediction ?? "Not entered"}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${scoreClass(entry?.calculated_score)}`}>
                    {entry?.calculated_score === null || entry?.calculated_score === undefined ? "Pending" : scoreLabel(entry.calculated_score)}
                  </span>
                  <span className={`text-lg text-slate-300 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true">⌄</span>
                </div>
              </button>
              {expanded ? (
                <div id={panelId} className="space-y-2 border-t border-white/10 p-4">
                  {entry ? (
                    <>
                      {selections.map((selection) => {
                        const fixture = fixtureById.get(selection.fixture_id);
                        const team = selection.selected_team_side === "home" ? fixture?.home_team_name : selection.selected_team_side === "away" ? fixture?.away_team_name : null;
                        const teamCrest = selection.selected_team_side === "home" ? fixture?.home_team_crest_url : selection.selected_team_side === "away" ? fixture?.away_team_crest_url : null;
                        const state = fixture && ["postponed", "cancelled"].includes(fixture.status) ? "Void" : selection.is_correct === null ? "Pending" : selection.is_correct ? "Correct" : "Incorrect";
                        return (
                          <div key={selection.id} className="brand-card-soft grid gap-2 p-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
                            <div>
                              <p className="font-bold text-white">{PICK_CATEGORY_LABELS[selection.category] ?? selection.category}</p>
                              {team ? <div className="mt-2 w-fit"><TeamIdentity name={team} crestUrl={teamCrest} /></div> : <p className="mt-1 text-xs text-slate-300">Selected team: Draw / no team</p>}
                              <p className="mt-1 text-xs text-slate-400">Fixture: {fixture ? `${fixture.home_team_name} v ${fixture.away_team_name}` : "Unavailable"}</p>
                              <p className={`mt-1 text-xs font-bold ${selectionStateClass(state)}`}>{state}</p>
                            </div>
                            <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-black ${scoreClass(selection.points_awarded)}`}>
                              {selection.points_awarded === null ? state : scoreLabel(selection.points_awarded)}
                            </span>
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between px-1 pt-2 text-sm">
                        <span className="text-slate-300">Total Goals points</span>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${scoreClass(totalGoalsPoints)}`}>
                          {totalGoalsPoints === null ? "Pending" : scoreLabel(totalGoalsPoints)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-slate-400">No submitted entry.</p>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
