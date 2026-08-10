import Link from "next/link";
import { getRequestAuthContext } from "@/utils/app-context";
import { createAdminClient } from "@/utils/supabase/admin";
import { buildMatchdayBreakdown } from "@/utils/pick8-matchday-breakdown";
import {
  buildStandings,
  playerMatchdayLifecycle,
  playerDisplayName,
  resolveCurrentCompetition,
  resolveDashboardMatchday,
  type StandingsCompetition,
  type StandingsEntry,
  type StandingsMatchday,
  type StandingsProfile,
} from "@/utils/pick8-standings";
import type { BreakdownEntry, BreakdownFixture, BreakdownSelection } from "@/utils/pick8-breakdown-types";
import {
  getPick8EntryState,
  PICK8_ENTRY_STATE_LABELS,
} from "@/utils/pick8-entry-validation";

function deadline(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
  }).format(new Date(value));
}

function matchdayTiming(matchday: StandingsMatchday, now: number) {
  const lifecycle = playerMatchdayLifecycle(matchday, now);
  if (lifecycle === "Completed") return "Final scores confirmed";
  if (lifecycle === "In progress") return "Fixtures underway";
  if (!matchday.locks_at) return "Kickoff time not set";
  const remainingMinutes = Math.ceil((Date.parse(matchday.locks_at) - now) / 60_000);
  const days = Math.floor(remainingMinutes / 1440);
  const hours = Math.floor((remainingMinutes % 1440) / 60);
  const minutes = remainingMinutes % 60;
  return `Picks lock in ${[days ? `${days}d` : "", hours ? `${hours}h` : "", `${minutes}m`].filter(Boolean).join(" ")}`;
}

function entryPresentation(matchday: StandingsMatchday, entry: BreakdownEntry | undefined, now: number) {
  const editable = ["open", "upcoming"].includes(matchday.status) && matchday.locks_at !== null && now < Date.parse(matchday.locks_at);
  const entryState = getPick8EntryState(entry);
  const status = PICK8_ENTRY_STATE_LABELS[entryState];
  if (entry?.calculated_score !== null && entry?.calculated_score !== undefined) return { status, cta: "View Results" };
  if (matchday.status === "completed") return { status, cta: "View Results" };
  if (matchday.status === "scoring") return { status, cta: "View Picks" };
  if (["locked", "scoring"].includes(matchday.status) || (matchday.locks_at !== null && now >= Date.parse(matchday.locks_at))) return { status, cta: "View Picks" };
  if (!entry) return { status, cta: "Make Picks" };
  if (!entry.submitted_at) return { status, cta: editable ? "Continue Picks" : "View Picks" };
  return { status, cta: editable ? "Edit Picks" : "View Picks" };
}

export default async function DashboardPage() {
  const { user, profile } = await getRequestAuthContext();
  if (!user || !profile?.is_active) return null;
  const admin = createAdminClient();
  const { data: season, error: seasonError } = await admin.from("seasons").select("id, name").eq("is_active", true).maybeSingle();
  if (seasonError || !season) return <section className="brand-card p-5"><p className="brand-eyebrow">Current matchday</p><h1 className="mt-2 text-xl font-black text-white">No active season</h1><p className="mt-2 text-sm text-slate-300">There is no active Pick8 season yet.</p></section>;

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
  const currentLifecycle = currentMatchday ? playerMatchdayLifecycle(currentMatchday, now) : null;
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

  return <div className="space-y-6">
    {currentMatchday && currentEntryUi && currentLifecycle ? <section className="brand-card border-emerald-300/30 bg-emerald-300/10 p-4 sm:p-5"><div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"><div className="min-w-0"><p className="brand-eyebrow">Current matchday · {season.name}</p><div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2"><h1 className="text-3xl font-black text-white">Matchday {currentMatchday.matchday_number}</h1><span className="brand-pill">{currentLifecycle}</span><span className="text-sm font-bold text-emerald-100">{currentEntryUi.status}</span></div><div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1"><p className="font-bold text-white">{matchdayTiming(currentMatchday, now)}</p>{currentLifecycle === "Open" && deadline(currentMatchday.locks_at) ? <p className="text-xs text-slate-400">Locks {deadline(currentMatchday.locks_at)} Melbourne time</p> : null}</div></div><div className="flex flex-col gap-3 sm:flex-row sm:items-center md:justify-end">{currentEntry?.calculated_score !== null && currentEntry?.calculated_score !== undefined ? <div className="text-left sm:text-right"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Score</p><p className="text-3xl font-black leading-none text-emerald-200">{currentEntry.calculated_score}<span className="ml-1 text-xs text-slate-400">pts</span></p></div> : null}<Link className="brand-button-primary w-full sm:w-auto" href={`/my-picks?matchday=${currentMatchday.matchday_number}`}>{currentEntryUi.cta}</Link></div></div></section> : <section className="brand-card p-5"><h1 className="text-xl font-black text-white">Current matchday</h1><p className="mt-2 text-sm text-slate-400">No matchdays are available for this season yet.</p></section>}

    <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
      {currentCompetition ? <section className="brand-card p-5 sm:p-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="brand-eyebrow">Current competition</p><h2 className="mt-2 text-2xl font-black text-white">{currentCompetition.name}</h2><p className="mt-1 text-sm text-slate-400">Matchdays {currentCompetition.start_matchday}–{currentCompetition.end_matchday}</p></div><p className="text-right text-sm text-slate-400">You are <strong className="ml-1 text-2xl text-emerald-200">{ownCompetition ? `#${ownCompetition.rank}` : "—"}</strong><span className="ml-2">with <strong className="text-white">{ownCompetition?.points ?? 0} pts</strong></span><span className="block text-xs">from {ownCompetition?.played ?? 0} scored matchdays</span></p></div>{competitionStandings.length ? <ol className="mt-6 divide-y divide-white/10 border-y border-white/10">{competitionStandings.slice(0, 3).map((row) => <li key={row.profile.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span className="min-w-0 truncate"><strong className="mr-3 text-emerald-200">#{row.rank}</strong>{playerDisplayName(row.profile)}</span><strong className="shrink-0 text-white">{row.points} pts</strong></li>)}</ol> : <p className="mt-5 text-sm text-slate-400">No active player standings are available.</p>}<Link href="/tables?view=competition" className="mt-4 inline-block text-sm font-bold text-emerald-200 hover:text-emerald-100">View competition table →</Link></section> : <section className="brand-card p-5 sm:p-6"><h2 className="text-xl font-black text-white">Current competition</h2><p className="mt-2 text-sm text-slate-400">No competition is available for this season.{profile.is_admin ? " Refresh competitions from Admin." : ""}</p></section>}

      <section className="brand-card p-5 sm:p-6"><p className="brand-eyebrow">Overall season</p><h2 className="mt-2 text-2xl font-black text-white">Your season</h2><p className="mt-5 text-4xl font-black text-white">{ownOverall ? `#${ownOverall.rank}` : "—"}<span className="ml-2 text-base font-bold text-slate-400">overall</span></p><p className="mt-3 text-sm leading-6 text-slate-300"><strong className="text-emerald-200">{ownOverall?.points ?? 0} points</strong> from {ownOverall?.played ?? 0} scored matchdays · {(ownOverall?.average ?? 0).toFixed(1)} average.</p><Link href="/tables?view=overall" className="mt-5 inline-block text-sm font-bold text-emerald-200 hover:text-emerald-100">View overall table →</Link></section>
    </div>

    {latestEntry && latestMatchday && latestResult ? <section className="brand-card overflow-hidden"><div className="grid sm:grid-cols-[minmax(0,1fr)_auto]"><div className="p-5 sm:p-6"><p className="brand-eyebrow">Latest result</p><h2 className="mt-2 text-3xl font-black text-white">Matchday {latestMatchday.matchday_number} recap</h2><p className="mt-3 text-sm text-slate-300">You predicted <strong className="text-white">{latestEntry.total_goals_prediction ?? "—"} total goals</strong>{latestResult.actualGoals !== null ? <>; the matchday finished with <strong className="text-white">{latestResult.actualGoals}</strong>.</> : "."}</p>{latestResult.totalGoalsPoints !== null ? <p className="mt-1 text-sm text-slate-400">Total Goals contributed {latestResult.totalGoalsPoints} points.</p> : null}<Link href={`/my-picks?matchday=${latestMatchday.matchday_number}`} className="brand-button-secondary mt-5 w-full sm:w-auto">Open matchday recap</Link></div><div className="grid min-w-40 place-content-center border-t border-white/10 bg-emerald-300/10 p-6 text-center sm:border-l sm:border-t-0"><p className="text-5xl font-black text-emerald-200">{latestEntry.calculated_score}</p><p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-400">points</p></div></div></section> : null}
  </div>;
}
