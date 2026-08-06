import Link from "next/link";
import { getRequestAuthContext } from "@/utils/app-context";
import { createAdminClient } from "@/utils/supabase/admin";
import { buildMatchdayBreakdown } from "@/utils/pick8-matchday-breakdown";
import {
  buildStandings,
  playerDisplayName,
  resolveCurrentCompetition,
  resolveDashboardMatchday,
  type StandingsCompetition,
  type StandingsEntry,
  type StandingsMatchday,
  type StandingsProfile,
} from "@/utils/pick8-standings";
import type { BreakdownEntry, BreakdownFixture, BreakdownSelection } from "@/utils/pick8-breakdown-types";

function deadline(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Melbourne" }).format(new Date(value));
}

function entryPresentation(matchday: StandingsMatchday, entry: BreakdownEntry | undefined, now: number) {
  const editable = ["open", "upcoming"].includes(matchday.status) && matchday.locks_at !== null && now < Date.parse(matchday.locks_at);
  if (entry?.calculated_score !== null && entry?.calculated_score !== undefined) return { status: "Final", cta: "View Results" };
  if (matchday.status === "completed") return { status: entry?.submitted_at ? "Pending score" : "No entry", cta: "View Results" };
  if (matchday.status === "scoring") return { status: entry?.submitted_at ? "Pending score" : "No entry", cta: "View Picks" };
  if (["locked", "scoring"].includes(matchday.status) || (matchday.locks_at !== null && now >= Date.parse(matchday.locks_at))) return { status: entry?.submitted_at ? "Locked" : entry ? "Draft" : "No entry", cta: "View Picks" };
  if (!entry) return { status: "No entry", cta: "Make Picks" };
  if (!entry.submitted_at) return { status: "Draft", cta: editable ? "Continue Picks" : "View Picks" };
  return { status: "Submitted", cta: editable ? "Edit Picks" : "View Picks" };
}

export default async function DashboardPage() {
  const { user, profile } = await getRequestAuthContext();
  if (!user || !profile?.is_active) return null;
  const admin = createAdminClient();
  const { data: season, error: seasonError } = await admin.from("seasons").select("id, name").eq("is_active", true).maybeSingle();
  if (seasonError || !season) return <div className="space-y-5"><header className="brand-card p-5 sm:p-7"><p className="brand-eyebrow">Pick8</p><h1 className="brand-title mt-2">Welcome, {profile.display_name.trim() || "Player"}</h1></header><p className="brand-card p-5 text-sm text-slate-300">There is no active Pick8 season yet.</p></div>;

  const [{ data: profileRows }, { data: matchdayRows }, { data: competitionRows }] = await Promise.all([
    admin.from("profiles").select("id, display_name").eq("is_active", true).order("display_name"),
    admin.from("matchdays").select("id, matchday_number, status, locks_at").eq("season_id", season.id).order("matchday_number"),
    admin.from("competitions").select("id, name, start_matchday, end_matchday, status").eq("season_id", season.id).order("start_matchday"),
  ]);
  const profiles = (profileRows ?? []) as StandingsProfile[];
  const matchdays = (matchdayRows ?? []) as StandingsMatchday[];
  const competitions = (competitionRows ?? []) as StandingsCompetition[];
  const matchdayIds = matchdays.map((matchday) => matchday.id);
  const { data: entryRows } = matchdayIds.length ? await admin.from("entries").select("id, user_id, matchday_id, total_goals_prediction, submitted_at, calculated_score, score_calculated_at").in("matchday_id", matchdayIds) : { data: [] };
  const entries = (entryRows ?? []) as BreakdownEntry[];
  const standingsEntries = entries as StandingsEntry[];
  const byMatchday = new Map(matchdays.map((matchday) => [matchday.id, matchday]));
  const now = new Date().getTime();
  const currentMatchday = resolveDashboardMatchday(matchdays, now);
  const currentEntry = currentMatchday ? entries.find((entry) => entry.user_id === user.id && entry.matchday_id === currentMatchday.id) : undefined;
  const currentEntryUi = currentMatchday ? entryPresentation(currentMatchday, currentEntry, now) : null;
  const currentCompetition = resolveCurrentCompetition(competitions, currentMatchday);
  const overall = buildStandings(profiles, standingsEntries, byMatchday);
  const competitionStandings = currentCompetition ? buildStandings(profiles, standingsEntries, byMatchday, { start: currentCompetition.start_matchday, end: currentCompetition.end_matchday }) : [];
  const ownOverall = overall.find((row) => row.profile.id === user.id);
  const ownCompetition = competitionStandings.find((row) => row.profile.id === user.id);
  const latestEntry = entries.filter((entry) => entry.user_id === user.id && entry.submitted_at !== null && entry.calculated_score !== null && byMatchday.get(entry.matchday_id)?.status === "completed").sort((a, b) => (byMatchday.get(b.matchday_id)?.matchday_number ?? 0) - (byMatchday.get(a.matchday_id)?.matchday_number ?? 0))[0];
  const latestMatchday = latestEntry ? byMatchday.get(latestEntry.matchday_id) : undefined;
  let latestResult: { actualGoals: number | null; totalGoalsPoints: number | null } | null = null;
  if (latestEntry && latestMatchday) {
    const [{ data: fixtures }, { data: selections }] = await Promise.all([
      admin.from("fixtures").select("id, home_team_name, away_team_name, home_team_crest_url, away_team_crest_url, kickoff_at, status, home_score, away_score").eq("matchday_id", latestMatchday.id),
      admin.from("entry_selections").select("id, entry_id, category, fixture_id, selected_team_side, points_awarded, is_correct").eq("entry_id", latestEntry.id),
    ]);
    const breakdown = buildMatchdayBreakdown({ matchday: latestMatchday, profiles: [{ id: user.id, display_name: profile.display_name }], entries: [latestEntry], selections: (selections ?? []) as BreakdownSelection[], fixtures: (fixtures ?? []) as BreakdownFixture[], viewerId: user.id, now });
    latestResult = { actualGoals: breakdown.actualGoals, totalGoalsPoints: breakdown.players[0]?.totalGoalsPoints ?? null };
  }

  return <div className="space-y-5">
    <header className="brand-card p-5 sm:p-7"><p className="brand-eyebrow">{season.name}</p><h1 className="brand-title mt-2">Welcome, {profile.display_name.trim() || "Player"}</h1><p className="brand-subtitle mt-2">Your Pick8 season at a glance.</p></header>

    {currentMatchday && currentEntryUi ? <section className="brand-card border-emerald-300/25 bg-emerald-300/10 p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="brand-eyebrow">Current matchday</p><h2 className="mt-2 text-3xl font-black text-white">Matchday {currentMatchday.matchday_number}</h2><p className="mt-1 text-sm capitalize text-slate-300">{currentMatchday.status}</p>{["open", "upcoming"].includes(currentMatchday.status) && deadline(currentMatchday.locks_at) ? <p className="mt-2 text-sm text-slate-300">Deadline {deadline(currentMatchday.locks_at)} Melbourne time</p> : null}</div><div className="text-right"><span className="brand-pill">{currentEntryUi.status}</span>{currentEntry?.calculated_score !== null && currentEntry?.calculated_score !== undefined ? <p className="mt-2 text-2xl font-black text-emerald-200">{currentEntry.calculated_score} pts</p> : null}</div></div><Link className="brand-button-primary mt-5 w-full sm:w-auto" href={`/my-picks?matchday=${currentMatchday.matchday_number}`}>{currentEntryUi.cta}</Link></section> : <section className="brand-card p-5"><h2 className="text-xl font-black text-white">Current matchday</h2><p className="mt-2 text-sm text-slate-400">No matchdays are available for this season yet.</p></section>}

    <div className="grid gap-5 lg:grid-cols-2">
      {currentCompetition ? <section className="brand-card p-5 sm:p-6"><p className="brand-eyebrow">Current competition</p><h2 className="mt-2 text-2xl font-black text-white">{currentCompetition.name}</h2><p className="mt-1 text-sm text-slate-400">Matchdays {currentCompetition.start_matchday}–{currentCompetition.end_matchday}</p><div className="mt-4 grid grid-cols-3 gap-2"><Stat label="Your rank" value={ownCompetition ? `#${ownCompetition.rank}` : "—"} /><Stat label="Points" value={String(ownCompetition?.points ?? 0)} /><Stat label="Scored" value={String(ownCompetition?.played ?? 0)} /></div>{competitionStandings.length ? <div className="mt-4 space-y-2">{competitionStandings.slice(0, 3).map((row) => <div key={row.profile.id} className="brand-card-soft flex items-center justify-between gap-3 px-3 py-2 text-sm"><span className="min-w-0 truncate"><strong className="mr-2 text-emerald-200">#{row.rank}</strong>{playerDisplayName(row.profile)}</span><strong className="shrink-0 text-white">{row.points} pts</strong></div>)}</div> : <p className="mt-4 text-sm text-slate-400">No active player standings are available.</p>}<Link href="/tables?view=competition" className="brand-button-secondary mt-4 w-full">View Competition Table</Link></section> : <section className="brand-card p-5 sm:p-6"><h2 className="text-xl font-black text-white">Current competition</h2><p className="mt-2 text-sm text-slate-400">No competition is available for this season.{profile.is_admin ? " Refresh competitions from Admin." : ""}</p></section>}

      <section className="brand-card p-5 sm:p-6"><p className="brand-eyebrow">Overall season</p><h2 className="mt-2 text-2xl font-black text-white">Your season</h2><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Rank" value={ownOverall ? `#${ownOverall.rank}` : "—"} /><Stat label="Points" value={String(ownOverall?.points ?? 0)} /><Stat label="Scored" value={String(ownOverall?.played ?? 0)} /><Stat label="Average" value={(ownOverall?.average ?? 0).toFixed(1)} /></div><Link href="/tables?view=overall" className="brand-button-secondary mt-4 w-full">View Overall Table</Link></section>
    </div>

    {latestEntry && latestMatchday && latestResult ? <section className="brand-card p-5 sm:p-6"><p className="brand-eyebrow">Latest result</p><div className="mt-2 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-black text-white">Matchday {latestMatchday.matchday_number}</h2><p className="mt-1 text-sm text-slate-400">Total Goals prediction: {latestEntry.total_goals_prediction ?? "Not entered"}{latestResult.actualGoals !== null ? ` · Actual: ${latestResult.actualGoals}` : ""}</p>{latestResult.totalGoalsPoints !== null ? <p className="mt-1 text-sm text-slate-400">Total Goals points: {latestResult.totalGoalsPoints}</p> : null}</div><p className="text-3xl font-black text-emerald-200">{latestEntry.calculated_score} pts</p></div><Link href={`/my-picks?matchday=${latestMatchday.matchday_number}`} className="brand-button-secondary mt-4 w-full sm:w-auto">View Breakdown</Link></section> : null}
  </div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="brand-card-soft min-w-0 p-3"><p className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-white">{value}</p></div>;
}
