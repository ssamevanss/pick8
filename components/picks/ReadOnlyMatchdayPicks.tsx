"use client";

import { useState } from "react";
import SubmittedPick8Summary, { type Pick8SummarySelection } from "@/components/picks/SubmittedPick8Summary";
import TeamIdentity from "@/components/picks/TeamIdentity";
import {
  findSubmittedPick8Player,
  PICK_CATEGORY_LABELS,
  type BreakdownFixture,
  type BreakdownMatchday,
  type BreakdownPlayer,
} from "@/utils/pick8-breakdown-types";
import { calculatePick8FixtureSelectionPoints } from "@/utils/pick8-scoring-rules";
import {
  fixtureLifecycleLabel,
  fixtureScoreStateLabel,
  formatPick8Kickoff,
  getFixtureLifecycle,
  getMatchdayGoalProgress,
  hasFixtureKickedOff,
  isSubmittedFixturePickRevealable,
} from "@/utils/pick8-fixture-state";
import {
  getPick8EntryState,
  isPick8Category,
  PICK8_ENTRY_STATE_LABELS,
} from "@/utils/pick8-entry-validation";

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

function fixturePickDescription(
  category: string,
  selectedTeamSide: string | null,
  fixture: BreakdownFixture,
) {
  const selectedTeam = selectedTeamSide === "home"
    ? fixture.home_team_name
    : selectedTeamSide === "away"
      ? fixture.away_team_name
      : null;
  if (category === "draw") return "Draw";
  if (category === "home_win") return `${fixture.home_team_name} to Win`;
  if (category === "away_win") return `${fixture.away_team_name} to Win`;
  if (!selectedTeam) return PICK_CATEGORY_LABELS[category] ?? category;
  if (category === "team_win") return `${selectedTeam} to Win`;
  if (category === "team_lose") return `${selectedTeam} to Lose`;
  if (category === "team_score") return `${selectedTeam} to Score`;
  if (category === "clean_sheet") return `${selectedTeam} Clean Sheet`;
  return `${PICK_CATEGORY_LABELS[category] ?? category} · ${selectedTeam}`;
}

function submittedLabel(value: string) {
  const submittedAt = new Date(value);
  if (Number.isNaN(submittedAt.getTime())) return "Submission time unavailable";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
    timeZoneName: "short",
  }).format(submittedAt);
}

export default function ReadOnlyMatchdayPicks({
  matchday,
  fixtures,
  players,
  actualGoals,
  finalReady,
  currentPlayerId,
  showFixtures = true,
  showPlayers = true,
  showCurrentPlayerSummary = true,
  now,
}: {
  matchday: BreakdownMatchday;
  fixtures: BreakdownFixture[];
  players: BreakdownPlayer[];
  actualGoals: number | null;
  finalReady: boolean;
  currentPlayerId: string;
  showFixtures?: boolean;
  showPlayers?: boolean;
  showCurrentPlayerSummary?: boolean;
  now: number;
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
  const [expandedFixtures, setExpandedFixtures] = useState<Set<string>>(new Set());
  const currentPlayer = players.find(({ player }) => player.id === currentPlayerId);
  const submittedCurrentPlayer = findSubmittedPick8Player(players, currentPlayerId);
  const currentSubmittedEntry = submittedCurrentPlayer?.entry ?? null;
  const currentSelections: Pick8SummarySelection[] = currentSubmittedEntry
    ? (currentPlayer?.selections ?? []).flatMap((selection) => isPick8Category(selection.category) ? [{
        category: selection.category,
        fixtureId: selection.fixture_id,
        selectedTeamSide: selection.selected_team_side === "home" || selection.selected_team_side === "away" ? selection.selected_team_side : null,
        pointsAwarded: selection.points_awarded,
      }] : [])
    : [];
  const goalProgress = getMatchdayGoalProgress(fixtures, now);

  function togglePlayer(playerId: string) {
    setExpandedPlayers((current) => {
      const next = new Set(current);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  function toggleFixture(fixtureId: string) {
    setExpandedFixtures((current) => {
      const next = new Set(current);
      if (next.has(fixtureId)) next.delete(fixtureId);
      else next.add(fixtureId);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      {showCurrentPlayerSummary && currentSubmittedEntry ? (
        <SubmittedPick8Summary
          fixtures={fixtures.map((fixture) => ({
            id: fixture.id,
            homeTeamName: fixture.home_team_name,
            awayTeamName: fixture.away_team_name,
            homeTeamCrestUrl: fixture.home_team_crest_url,
            awayTeamCrestUrl: fixture.away_team_crest_url,
            kickoffAt: fixture.kickoff_at,
            status: fixture.status,
            homeScore: fixture.home_score,
            awayScore: fixture.away_score,
          }))}
          selections={currentSelections}
          totalGoals={currentSubmittedEntry.total_goals_prediction}
          actualGoals={actualGoals}
          finalReady={finalReady}
          finalMatchdayScore={currentSubmittedEntry.calculated_score}
          totalGoalsPoints={submittedCurrentPlayer?.totalGoalsPoints ?? null}
          now={now}
        />
      ) : showCurrentPlayerSummary ? <section className="brand-card p-4 sm:p-5"><p className="brand-eyebrow">Your Pick8</p><h2 className="mt-1 text-xl font-black text-white">No entry submitted</h2><p className="mt-2 text-sm text-slate-400">You did not submit a Pick8 entry for Matchday {matchday.matchday_number}.</p></section> : null}
      {showFixtures ? (
        <section className="brand-card p-4 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="brand-eyebrow">Matchday fixtures</p><h2 className="mt-1 text-2xl font-black text-white">Matchday {matchday.matchday_number}</h2></div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-400">{finalReady ? "Actual Total Goals" : goalProgress.hasStarted ? "Current Total Goals" : "Total Goals"}</p>
              <p className="text-2xl font-black text-emerald-200">{finalReady ? actualGoals : goalProgress.hasStarted ? goalProgress.currentGoals : "Pending"}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {fixtures.map((fixture) => {
              const started = hasFixtureKickedOff(fixture.kickoff_at, now);
              const fixtureLifecycle = getFixtureLifecycle(fixture, now);
              const scoreStateLabel = fixtureScoreStateLabel(fixtureLifecycle);
              const expanded = expandedFixtures.has(fixture.id);
              const ownSelection = currentPlayer?.entry?.submitted_at
                ? currentPlayer.selections.find((selection) => selection.fixture_id === fixture.id)
                : null;
              const fixturePicks = players.flatMap(({ player, entry, selections }) =>
                selections
                  .filter((selection) => isSubmittedFixturePickRevealable({
                    submittedAt: entry?.submitted_at ?? null,
                    fixtureId: fixture.id,
                    selectionFixtureId: selection.fixture_id,
                    kickoffAt: fixture.kickoff_at,
                    now,
                  }))
                  .map((selection) => ({ player, entry, selection })),
              );
              const ownPickLabel = ownSelection
                ? fixturePickDescription(ownSelection.category, ownSelection.selected_team_side, fixture)
                : "No selection";
              const content = <><div className="grid min-w-0 gap-1.5"><TeamIdentity name={fixture.home_team_name} crestUrl={fixture.home_team_crest_url} /><TeamIdentity name={fixture.away_team_name} crestUrl={fixture.away_team_crest_url} /><p className="text-xs text-slate-400">{formatPick8Kickoff(fixture.kickoff_at)} · {fixtureLifecycleLabel(fixtureLifecycle)}</p><p className="truncate text-xs text-slate-300"><span className="font-bold text-white">Your Pick8:</span> {ownPickLabel}</p><p className={`text-xs font-bold ${started ? "text-emerald-200" : "text-slate-500"}`}>{started ? expanded ? "Hide all picks ↑" : "View all picks →" : "Other players’ picks hidden until kickoff"}</p></div><div className="flex shrink-0 items-center gap-2"><p className="text-lg font-black tabular-nums text-white">{fixture.home_score ?? "–"}–{fixture.away_score ?? "–"}</p>{scoreStateLabel ? <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${scoreStateLabel === "LIVE" ? "border-emerald-400/35 bg-emerald-400/15 text-emerald-200" : "border-slate-500/40 bg-slate-700/50 text-slate-300"}`}>{scoreStateLabel}</span> : null}</div></>;
              return <div key={fixture.id} className="brand-card-soft overflow-hidden text-sm">{started ? <button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-300/70" aria-expanded={expanded} onClick={() => toggleFixture(fixture.id)}>{content}</button> : <div className="flex items-center justify-between gap-3 p-3">{content}</div>}{started && expanded ? <div className="space-y-2 border-t border-white/10 p-3">{fixturePicks.length ? fixturePicks.map(({ player, selection }) => {
                const category = isPick8Category(selection.category) ? selection.category : null;
                const liveResult = category ? calculatePick8FixtureSelectionPoints(
                  { category, selected_team_side: selection.selected_team_side === "home" || selection.selected_team_side === "away" ? selection.selected_team_side : null },
                  { home_score: fixture.home_score, away_score: fixture.away_score },
                ) : null;
                const displayedPoints = fixture.status === "finished" && selection.points_awarded !== null
                  ? selection.points_awarded
                  : liveResult?.pointsAwarded ?? null;
                const voidFixture = ["postponed", "cancelled"].includes(fixture.status);
                return <div key={selection.id} className="flex items-center justify-between gap-3 text-xs"><span className="text-slate-300"><strong className="text-white">{player.display_name}</strong> · {fixturePickDescription(selection.category, selection.selected_team_side, fixture)}</span><span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-black ${voidFixture ? "border-amber-300/30 bg-amber-300/10 text-amber-200" : scoreClass(displayedPoints)}`}>{voidFixture ? "Void" : displayedPoints === null ? "Pending" : scoreLabel(displayedPoints)}</span></div>;
              }) : <p className="text-xs text-slate-400">No submitted selections were made against this fixture.</p>}</div> : null}</div>;
            })}
          </div>
        </section>
      ) : null}
      {showPlayers ? <div className="space-y-3">
        {players.map(({ player, entry, selections, totalGoalsPoints }) => {
          const entryState = getPick8EntryState(entry);
          const status = entryState === "not_started"
            ? "No entry submitted"
            : PICK8_ENTRY_STATE_LABELS[entryState];
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
                    {status}{entry?.submitted_at ? ` · ${submittedLabel(entry.submitted_at)}` : ""}{entry ? ` · Total Goals: ${entry.total_goals_prediction ?? "Not entered"}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${scoreClass(entry?.calculated_score)}`}>
                    {!entry ? "No entry" : !entry.submitted_at ? "Not submitted" : entry.calculated_score === null ? "Awaiting score" : scoreLabel(entry.calculated_score)}
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
                          {!entry.submitted_at ? "Not submitted" : totalGoalsPoints === null ? "Pending" : scoreLabel(totalGoalsPoints)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-slate-400">No entry submitted.</p>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div> : null}
    </div>
  );
}
