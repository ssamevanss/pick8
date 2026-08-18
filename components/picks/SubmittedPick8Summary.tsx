import type { ReactNode } from "react";
import TeamIdentity, { TeamCrest } from "@/components/picks/TeamIdentity";
import {
  fixtureScoreStateLabel,
  getFixtureLifecycle,
  getMatchdayGoalProgress,
} from "@/utils/pick8-fixture-state";
import {
  calculatePick8FixtureSelectionPoints,
  sumPick8Points,
  type Pick8ScoringCategory,
  type Pick8ScoringTeamSide,
} from "@/utils/pick8-scoring-rules";

export type Pick8SummaryFixture = {
  id: string;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamCrestUrl: string | null;
  awayTeamCrestUrl: string | null;
  kickoffAt: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
};

export type Pick8SummarySelection = {
  category: Pick8ScoringCategory;
  fixtureId: string;
  selectedTeamSide: Pick8ScoringTeamSide;
  pointsAwarded?: number | null;
};

const CATEGORY_LABELS: Record<Pick8ScoringCategory, string> = {
  home_win: "Home Winner",
  away_win: "Away Winner",
  draw: "Draw",
  team_win: "Team to Win",
  team_lose: "Team to Lose",
  team_score: "Team to Score",
  clean_sheet: "Clean Sheet",
};

function pointsPillClass(points: number | null) {
  if (points === null) return "border-slate-500/40 bg-slate-700/50 text-slate-200";
  if (points > 0) return "border-emerald-400/35 bg-emerald-400/15 text-emerald-100";
  if (points < 0) return "border-rose-400/35 bg-rose-400/15 text-rose-100";
  return "border-amber-300/35 bg-amber-300/10 text-amber-100";
}

function pointsLabel(points: number) {
  return points > 0 ? `+${points}` : String(points);
}

export default function SubmittedPick8Summary({
  fixtures,
  selections,
  totalGoals,
  actualGoals,
  finalReady,
  finalMatchdayScore,
  totalGoalsPoints,
  now,
  action,
}: {
  fixtures: Pick8SummaryFixture[];
  selections: Pick8SummarySelection[];
  totalGoals: number | string | null;
  actualGoals: number | null;
  finalReady: boolean;
  finalMatchdayScore: number | null;
  totalGoalsPoints: number | null;
  now: number;
  action?: ReactNode;
}) {
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const visibleSelections = selections.flatMap((selection) => {
    const fixture = fixtureById.get(selection.fixtureId);
    return fixture ? [{ selection, fixture }] : [];
  });
  const goalProgress = getMatchdayGoalProgress(
    fixtures.map((fixture) => ({
      kickoff_at: fixture.kickoffAt,
      status: fixture.status,
      home_score: fixture.homeScore,
      away_score: fixture.awayScore,
    })),
    now,
  );
  const scoredSelections = visibleSelections.map(({ fixture, selection }) => {
    const lifecycle = getFixtureLifecycle(
      { kickoff_at: fixture.kickoffAt, status: fixture.status },
      now,
    );
    const liveResult = calculatePick8FixtureSelectionPoints(
      { category: selection.category, selected_team_side: selection.selectedTeamSide },
      { home_score: fixture.homeScore, away_score: fixture.awayScore },
    );
    const displayedPoints = fixture.status === "finished" && selection.pointsAwarded !== null && selection.pointsAwarded !== undefined
      ? selection.pointsAwarded
      : liveResult?.pointsAwarded ?? null;
    return { fixture, selection, lifecycle, displayedPoints };
  });
  const currentMatchdayScore = sumPick8Points(
    scoredSelections.map(({ lifecycle, displayedPoints }) =>
      lifecycle === "upcoming" || lifecycle === "void" ? null : displayedPoints,
    ),
    finalReady ? totalGoalsPoints : null,
  );
  const showCurrentMatchdayScore = goalProgress.hasStarted && finalMatchdayScore === null;

  return (
    <section className="brand-card p-4">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="brand-eyebrow">Your Pick8</p><h2 className="mt-1 text-xl font-black text-white">Seven picks + Total Goals</h2></div>
        {action ? <div className="w-full sm:w-auto">{action}</div> : null}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {scoredSelections.map(({ fixture, selection, lifecycle, displayedPoints }) => {
          const selectedTeam = selection.selectedTeamSide === "home"
            ? fixture.homeTeamName
            : selection.selectedTeamSide === "away"
              ? fixture.awayTeamName
              : "Draw / no team";
          const selectedCrest = selection.selectedTeamSide === "home"
            ? fixture.homeTeamCrestUrl
            : selection.selectedTeamSide === "away"
              ? fixture.awayTeamCrestUrl
              : null;
          const scoreStateLabel = fixtureScoreStateLabel(lifecycle);
          const started = lifecycle !== "upcoming";
          const voidFixture = ["postponed", "cancelled"].includes(fixture.status);
          return (
            <div key={`${selection.category}:${fixture.id}`} className="brand-card-soft p-2.5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <p className="text-xs font-black uppercase tracking-wide text-emerald-200">{CATEGORY_LABELS[selection.category]}</p>
                  {scoreStateLabel ? <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-black ${scoreStateLabel === "LIVE" ? "border-emerald-400/35 bg-emerald-400/15 text-emerald-200" : "border-slate-500/40 bg-slate-700/50 text-slate-300"}`}>{scoreStateLabel}</span> : null}
                </div>
                {started ? <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-black tabular-nums ${pointsPillClass(displayedPoints)}`}>{voidFixture ? "Void" : displayedPoints === null ? "Pending" : pointsLabel(displayedPoints)}</span> : null}
              </div>
              <div className="mt-1.5">{selection.selectedTeamSide ? <TeamIdentity name={selectedTeam} crestUrl={selectedCrest} /> : <p className="font-bold text-white">{selectedTeam}</p>}</div>
              <div className="mt-2 flex min-w-0 items-center gap-2 border-t border-white/10 pt-2 text-[11px] text-slate-400">
                <span className="flex shrink-0 -space-x-1"><TeamCrest name={fixture.homeTeamName} crestUrl={fixture.homeTeamCrestUrl} /><TeamCrest name={fixture.awayTeamName} crestUrl={fixture.awayTeamCrestUrl} /></span>
                <span className="truncate" title={`${fixture.homeTeamName} v ${fixture.awayTeamName}`}>{fixture.homeTeamName} v {fixture.awayTeamName}</span>
              </div>
            </div>
          );
        })}
        <div className="brand-card-soft flex items-center justify-between gap-3 p-2.5 text-sm lg:block">
          <div><p className="text-xs font-black uppercase tracking-wide text-emerald-200">Total Goals</p>{finalReady && actualGoals !== null ? <p className="mt-1 text-xs text-slate-400">Actual total: {actualGoals}</p> : goalProgress.hasStarted ? <p className="mt-1 text-xs text-slate-400">Current total: {goalProgress.currentGoals}</p> : null}</div>
          <div className="flex items-center gap-2 lg:mt-1"><p className="text-2xl font-black text-white">{totalGoals ?? "—"}</p>{finalReady && totalGoalsPoints !== null ? <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${pointsPillClass(totalGoalsPoints)}`}>{pointsLabel(totalGoalsPoints)}</span> : null}</div>
        </div>
      </div>
      {finalMatchdayScore !== null || showCurrentMatchdayScore ? (
        <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 sm:px-5">
          <p className="text-xs font-black uppercase tracking-wider text-emerald-200">
            {finalMatchdayScore !== null ? "Final Matchday Score" : "Current Matchday Score"}
          </p>
          <p className="text-3xl font-black tabular-nums text-white">
            {pointsLabel(finalMatchdayScore ?? currentMatchdayScore)}
            <span className="ml-1 text-xs uppercase tracking-wide text-slate-400">pts</span>
          </p>
        </div>
      ) : null}
    </section>
  );
}
