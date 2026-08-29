import Link from "next/link";
import { getRequestAuthContext } from "@/utils/app-context";
import { createInteractiveAdminClient } from "@/utils/supabase/admin";
import { requireSuccessfulDatabaseOperation } from "@/utils/supabase/resilience";
import { buildMatchdayBreakdown } from "@/utils/pick8-matchday-breakdown";
import {
  buildStandings,
  currentCompetitionStandings,
  overallSeasonStandings,
  playerMatchdayLifecycle,
  playerDisplayName,
  resolveCurrentCompetition,
  resolveDashboardMatchday,
  resolveNextEditableDashboardMatchday,
  type StandingsCompetition,
  type StandingsEntry,
  type StandingsMatchday,
  type StandingsProfile,
} from "@/utils/pick8-standings";
import type { BreakdownEntry, BreakdownFixture, BreakdownSelection } from "@/utils/pick8-breakdown-types";
import {
  getPick8EntryState,
  PICK8_CATEGORIES,
  type Pick8Category,
} from "@/utils/pick8-entry-validation";

type StandingRow = ReturnType<typeof buildStandings>[number];

const TEAM_PICK_CATEGORIES = new Set<Pick8Category>(["team_win", "team_lose", "team_score", "clean_sheet"]);

function matchdayTiming(matchday: StandingsMatchday, now: number) {
  const lifecycle = playerMatchdayLifecycle(matchday, now);
  if (lifecycle === "Completed") return "Final scores confirmed";
  if (lifecycle === "In progress") return "Games are live";
  if (!matchday.locks_at) return "Kickoff time not set";
  const remainingMinutes = Math.ceil((Date.parse(matchday.locks_at) - now) / 60_000);
  const days = Math.floor(remainingMinutes / 1440);
  const hours = Math.floor((remainingMinutes % 1440) / 60);
  const minutes = remainingMinutes % 60;
  return `Picks lock in ${[days ? `${days}d` : "", hours ? `${hours}h` : "", `${minutes}m`].filter(Boolean).join(" ")}`;
}

function selectionProgress(entry: BreakdownEntry | undefined, selections: BreakdownSelection[]) {
  if (!entry) return 0;
  const counts = new Map<Pick8Category, number>();
  for (const selection of selections) {
    if (!PICK8_CATEGORIES.includes(selection.category as Pick8Category)) continue;
    const category = selection.category as Pick8Category;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const completedPicks = PICK8_CATEGORIES.filter((category) => {
    if (counts.get(category) !== 1) return false;
    if (!TEAM_PICK_CATEGORIES.has(category)) return true;
    return selections.some((selection) => selection.category === category && (selection.selected_team_side === "home" || selection.selected_team_side === "away"));
  }).length;
  const totalGoals = entry.total_goals_prediction;
  const totalGoalsComplete = totalGoals !== null && Number.isInteger(totalGoals) && totalGoals >= 0 && totalGoals <= 100;
  return completedPicks + (totalGoalsComplete ? 1 : 0);
}

function entryPresentation(matchday: StandingsMatchday, entry: BreakdownEntry | undefined, now: number, progress: number) {
  const lifecycle = playerMatchdayLifecycle(matchday, now);
  const entryState = getPick8EntryState(entry);
  if (lifecycle === "Completed") return { status: "Completed", detail: "Final scores confirmed", cta: "View Results" };
  if (lifecycle === "In progress") return { status: "In progress", detail: "Your picks and other players’ picks become visible fixture by fixture.", cta: "View Matchday" };
  if (entryState === "not_started") return { status: "Not started", detail: "0 of 8 complete", cta: "Make Picks" };
  if (entryState === "submitted") return { status: "Submitted", detail: "Your Pick8 is locked in.", cta: "View Picks" };
  if (progress === 8) return { status: "Ready to submit", detail: "8 of 8 complete · Ready to submit", cta: "Submit Picks" };
  return { status: "Draft — Not submitted", detail: `${progress} of 8 complete · Not submitted`, cta: "Continue Picks" };
}

function contextualRows(rows: StandingRow[], userId: string) {
  if (rows.length <= 3) return rows;
  const ownIndex = rows.findIndex((row) => row.profile.id === userId);
  if (ownIndex <= 1) return rows.slice(0, 3);
  if (ownIndex >= rows.length - 2) return rows.slice(-3);
  return rows.slice(ownIndex - 1, ownIndex + 2);
}

function ContextTable({ rows, userId }: { rows: StandingRow[]; userId: string }) {
  if (!rows.length) return <p className="mt-4 text-sm text-slate-400">No standings yet.</p>;
  return <ol className="mt-4 divide-y divide-white/10 border-y border-white/10">{contextualRows(rows, userId).map((row) => {
    const isCurrentPlayer = row.profile.id === userId;
    return <li key={row.profile.id} className={`flex items-center gap-3 px-1 py-2.5 text-sm ${isCurrentPlayer ? "text-white" : "text-slate-300"}`}><strong className={`w-8 shrink-0 ${isCurrentPlayer ? "text-emerald-200" : "text-slate-500"}`}>#{row.rank}</strong><span className="min-w-0 flex-1 truncate font-semibold">{playerDisplayName(row.profile)}{isCurrentPlayer ? <span className="ml-2 text-xs font-bold text-emerald-300">You</span> : null}</span><strong className="shrink-0 text-white">{row.points} pts</strong></li>;
  })}</ol>;
}

export default async function DashboardPage() {
  const { user, profile, requestDeadlineSignal, requestId } = await getRequestAuthContext();
  if (!user || !profile?.is_active) return null;
  const admin = createInteractiveAdminClient({
    overallSignal: requestDeadlineSignal,
    context: { page: "dashboard", operation: "load-dashboard", requestId },
  });
  const { data: season, error: seasonError } = await admin.from("seasons").select("id, name").eq("is_active", true).maybeSingle();
  requireSuccessfulDatabaseOperation(seasonError);
  if (!season) return <section className="brand-card p-5"><p className="brand-eyebrow">Current matchday</p><h1 className="mt-2 text-xl font-black text-white">No active season</h1><p className="mt-2 text-sm text-slate-300">There is no active Pick8 season yet.</p></section>;

  const [profilesResult, matchdaysResult, competitionsResult] = await Promise.all([
    admin.from("profiles").select("id, display_name, is_active, pick8_participation_active").order("display_name"),
    admin.from("matchdays").select("id, matchday_number, status, locks_at").eq("season_id", season.id).order("matchday_number"),
    admin.from("competitions").select("id, name, start_matchday, end_matchday, status").eq("season_id", season.id).order("start_matchday"),
  ]);
  requireSuccessfulDatabaseOperation(profilesResult.error);
  requireSuccessfulDatabaseOperation(matchdaysResult.error);
  requireSuccessfulDatabaseOperation(competitionsResult.error);
  const profiles = (profilesResult.data ?? []) as StandingsProfile[];
  const matchdays = (matchdaysResult.data ?? []) as StandingsMatchday[];
  const competitions = (competitionsResult.data ?? []) as StandingsCompetition[];
  const matchdayIds = matchdays.map((matchday) => matchday.id);
  const { data: entryRows, error: entriesError } = matchdayIds.length ? await admin.from("entries").select("id, user_id, matchday_id, total_goals_prediction, submitted_at, calculated_score, score_calculated_at").in("matchday_id", matchdayIds) : { data: [], error: null };
  requireSuccessfulDatabaseOperation(entriesError);
  const entries = (entryRows ?? []) as BreakdownEntry[];
  const standingsEntries = entries as StandingsEntry[];
  const byMatchday = new Map(matchdays.map((matchday) => [matchday.id, matchday]));
  const now = new Date().getTime();
  const currentMatchday = resolveDashboardMatchday(matchdays, now);
  const nextEditableMatchday = resolveNextEditableDashboardMatchday(matchdays, currentMatchday, now);
  const currentEntry = currentMatchday ? entries.find((entry) => entry.user_id === user.id && entry.matchday_id === currentMatchday.id) : undefined;
  const nextEditableEntry = nextEditableMatchday ? entries.find((entry) => entry.user_id === user.id && entry.matchday_id === nextEditableMatchday.id) : undefined;
  const currentLifecycle = currentMatchday ? playerMatchdayLifecycle(currentMatchday, now) : null;
  const currentCompetition = resolveCurrentCompetition(competitions, currentMatchday);
  const overall = overallSeasonStandings(buildStandings(profiles, standingsEntries, byMatchday));
  const competitionStandings = currentCompetition ? currentCompetitionStandings(buildStandings(profiles, standingsEntries, byMatchday, { start: currentCompetition.start_matchday, end: currentCompetition.end_matchday })) : [];
  const ownOverall = overall.find((row) => row.profile.id === user.id);
  const ownCompetition = competitionStandings.find((row) => row.profile.id === user.id);
  const latestEntries = entries
    .filter((entry) => entry.user_id === user.id && entry.submitted_at !== null && entry.calculated_score !== null && byMatchday.get(entry.matchday_id)?.status === "completed")
    .sort((a, b) => (byMatchday.get(b.matchday_id)?.matchday_number ?? 0) - (byMatchday.get(a.matchday_id)?.matchday_number ?? 0))
    .slice(0, 3);
  const relevantEntryIds = [...new Set([currentEntry?.id, ...latestEntries.map((entry) => entry.id)].filter((id): id is string => Boolean(id)))];
  let relevantSelections: BreakdownSelection[] = [];
  if (relevantEntryIds.length) {
    const { data, error } = await admin.from("entry_selections").select("id, entry_id, category, fixture_id, selected_team_side, points_awarded, is_correct").in("entry_id", relevantEntryIds);
    requireSuccessfulDatabaseOperation(error);
    relevantSelections = (data ?? []) as BreakdownSelection[];
  }
  const latestMatchdayIds = latestEntries.map((entry) => entry.matchday_id);
  let latestFixtures: (BreakdownFixture & { matchday_id: string })[] = [];
  if (latestMatchdayIds.length) {
    const { data, error } = await admin.from("fixtures").select("id, matchday_id, home_team_name, away_team_name, home_team_crest_url, away_team_crest_url, kickoff_at, status, home_score, away_score").in("matchday_id", latestMatchdayIds);
    requireSuccessfulDatabaseOperation(error);
    latestFixtures = (data ?? []) as (BreakdownFixture & { matchday_id: string })[];
  }
  const currentProgress = selectionProgress(currentEntry, relevantSelections.filter((selection) => selection.entry_id === currentEntry?.id));
  const currentEntryUi = currentMatchday
    ? !profile.pick8_participation_active && playerMatchdayLifecycle(currentMatchday, now) !== "Completed"
      ? {
          status: "Participation paused",
          detail: "You can view this matchday, but cannot submit or edit picks while participation is paused.",
          cta: "View Matchday",
        }
      : entryPresentation(currentMatchday, currentEntry, now, currentProgress)
    : null;
  const latestResults = latestEntries.flatMap((entry) => {
    const matchday = byMatchday.get(entry.matchday_id);
    if (!matchday) return [];
    const breakdown = buildMatchdayBreakdown({
      matchday,
      profiles: [{ id: user.id, display_name: profile.display_name }],
      entries: [entry],
      selections: relevantSelections.filter((selection) => selection.entry_id === entry.id),
      fixtures: latestFixtures.filter((fixture) => fixture.matchday_id === matchday.id),
      viewerId: user.id,
      now,
    });
    return [{ entry, matchday, actualGoals: breakdown.actualGoals, totalGoalsPoints: breakdown.players[0]?.totalGoalsPoints ?? null }];
  });

  return <div className="space-y-6">
    {currentMatchday && currentEntryUi && currentLifecycle ? <section className="brand-card border-emerald-300/30 bg-[linear-gradient(110deg,rgba(52,211,153,0.14),rgba(15,23,42,0.2))] p-4 sm:p-5"><div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"><div className="min-w-0"><p className="brand-eyebrow">Current matchday · {season.name}</p><div className="mt-1 flex flex-wrap items-center gap-2"><h1 className="text-2xl font-black text-white sm:text-3xl">Matchday {currentMatchday.matchday_number}</h1><span className="brand-pill">{currentEntryUi.status}</span></div><p className="mt-2 font-bold text-emerald-100">{matchdayTiming(currentMatchday, now)}</p><p className="mt-1 text-sm text-slate-300">{currentEntryUi.detail}</p></div><div className="flex items-center justify-between gap-4 md:justify-end">{currentLifecycle === "Completed" && currentEntry?.calculated_score !== null && currentEntry?.calculated_score !== undefined ? <div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Your score</p><p className="text-2xl font-black text-emerald-200">{currentEntry.calculated_score} pts</p></div> : null}<Link className="brand-button-primary w-full sm:w-auto" href={`/my-picks?matchday=${currentMatchday.matchday_number}`}>{currentEntryUi.cta}</Link></div></div>{currentLifecycle === "In progress" && nextEditableMatchday && profile.pick8_participation_active ? <div className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between"><p className="font-semibold text-slate-300">Matchday {nextEditableMatchday.matchday_number} picks are open{nextEditableEntry?.submitted_at ? " · Submitted" : ""}</p><Link className="font-bold text-emerald-200 hover:text-emerald-100" href={`/my-picks?matchday=${nextEditableMatchday.matchday_number}`}>{nextEditableEntry?.submitted_at ? "View or edit picks" : nextEditableEntry ? "Continue picks" : "Make picks"} →</Link></div> : null}</section> : <section className="brand-card p-5"><h1 className="text-xl font-black text-white">Current matchday</h1><p className="mt-2 text-sm text-slate-400">No matchdays are available for this season yet.</p></section>}

    <div className="grid gap-5 lg:grid-cols-2">
      {currentCompetition ? <section className="brand-card p-4 sm:p-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="brand-eyebrow">Current competition</p><h2 className="mt-1 truncate text-xl font-black text-white">{currentCompetition.name}</h2><p className="text-xs text-slate-400">Matchdays {currentCompetition.start_matchday}–{currentCompetition.end_matchday}</p></div><div className="flex shrink-0 gap-5 text-right"><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Rank</p><p className="text-2xl font-black text-emerald-200">{ownCompetition ? `#${ownCompetition.rank}` : "—"}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Points</p><p className="text-2xl font-black text-white">{ownCompetition?.points ?? 0}</p></div></div></div><ContextTable rows={competitionStandings} userId={user.id} /><Link href="/tables?view=competition" className="mt-3 inline-block text-sm font-bold text-emerald-200 hover:text-emerald-100">View competition table →</Link></section> : <section className="brand-card p-5"><h2 className="text-xl font-black text-white">Current competition</h2><p className="mt-2 text-sm text-slate-400">No competition is available for this season.{profile.is_admin ? " Refresh competitions from Admin." : ""}</p></section>}

      <section className="brand-card border-sky-300/15 bg-sky-300/[0.03] p-4 sm:p-5"><div className="flex items-start justify-between gap-4"><div><p className="brand-eyebrow text-sky-200">Overall season</p><h2 className="mt-1 text-xl font-black text-white">{season.name}</h2><p className="mt-1 text-xs text-slate-400">{ownOverall?.played ?? 0} matchdays scored · {(ownOverall?.average ?? 0).toFixed(1)} average</p></div><div className="flex shrink-0 gap-5 text-right"><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Rank</p><p className="text-2xl font-black text-sky-200">{ownOverall ? `#${ownOverall.rank}` : "—"}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Points</p><p className="text-2xl font-black text-white">{ownOverall?.points ?? 0}</p></div></div></div><ContextTable rows={overall} userId={user.id} /><Link href="/tables?view=overall" className="mt-3 inline-block text-sm font-bold text-sky-200 hover:text-sky-100">View overall table →</Link></section>
    </div>

    <section><div className="flex items-end justify-between gap-4"><div><p className="brand-eyebrow">Latest results</p><h2 className="mt-1 text-xl font-black text-white">Recent matchdays</h2></div></div>{latestResults.length ? <div className="mt-3 grid gap-3 md:grid-cols-3">{latestResults.map(({ entry, matchday, actualGoals, totalGoalsPoints }) => <article key={entry.id} className="brand-card flex min-h-40 flex-col p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Matchday {matchday.matchday_number}</p><p className="mt-1 text-3xl font-black text-emerald-200">{entry.calculated_score}<span className="ml-1 text-xs text-slate-400">pts</span></p></div>{totalGoalsPoints !== null ? <span className="brand-pill">TG +{totalGoalsPoints}</span> : null}</div><p className="mt-3 text-sm text-slate-300">Total Goals: <strong className="text-white">{entry.total_goals_prediction ?? "—"} predicted</strong>{actualGoals !== null ? ` · ${actualGoals} actual` : ""}</p><Link href={`/my-picks?matchday=${matchday.matchday_number}`} className="mt-auto pt-4 text-sm font-bold text-emerald-200 hover:text-emerald-100">View recap →</Link></article>)}</div> : <p className="mt-3 text-sm text-slate-400">Completed matchday recaps will appear here.</p>}</section>
  </div>;
}
