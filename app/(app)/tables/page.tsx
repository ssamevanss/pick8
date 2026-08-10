import Link from "next/link";
import { getRequestAuthContext } from "@/utils/app-context";
import { createAdminClient } from "@/utils/supabase/admin";
import ReadOnlyMatchdayPicks from "@/components/picks/ReadOnlyMatchdayPicks";
import MatchdaySelectNavigation from "@/components/picks/MatchdaySelectNavigation";
import { buildMatchdayBreakdown } from "@/utils/pick8-matchday-breakdown";
import {
  buildStandings,
  playerDisplayName,
  resolveCurrentCompetition,
  resolveCurrentMatchday,
  type StandingsCompetition as Competition,
  type StandingsEntry,
  type StandingsMatchday as Matchday,
  type StandingsProfile as Profile,
} from "@/utils/pick8-standings";

type View = "competition" | "overall" | "matchday";
type Entry = StandingsEntry & { total_goals_prediction: number | null; score_calculated_at: string | null };

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Melbourne",
  }).format(new Date(value));
}

function scoreLabel(score: number | null) {
  if (score === null) return "Pending";
  return score > 0 ? `+${score}` : String(score);
}


function StandingsTable({
  rows,
  latestColumn,
}: {
  rows: ReturnType<typeof buildStandings>;
  latestColumn: "latest" | "average";
}) {
  return (
    <div className="brand-table overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-400">
          <tr><th className="px-4 py-3">Rank</th><th className="px-4 py-3">Player</th><th className="px-4 py-3 text-right">Points</th><th className="px-4 py-3 text-right">Played</th><th className="px-4 py-3 text-right">{latestColumn === "latest" ? "Latest" : "Average"}</th></tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {rows.map((row) => (
            <tr key={row.profile.id}>
              <td className="px-4 py-3"><span className="brand-pill">#{row.rank}</span></td>
              <td className="px-4 py-3 font-bold text-white">{playerDisplayName(row.profile)}</td>
              <td className="px-4 py-3 text-right font-black text-emerald-200">{scoreLabel(row.points)}</td>
              <td className="px-4 py-3 text-right text-slate-300">{row.played}</td>
              <td className="px-4 py-3 text-right text-slate-300">{latestColumn === "latest" ? scoreLabel(row.latest) : row.played ? row.average.toFixed(1) : "0.0"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function TablesPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string; matchday?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const view: View = ["competition", "overall", "matchday"].includes(params.view ?? "")
    ? (params.view as View)
    : "competition";
  const { supabase, user, profile } = await getRequestAuthContext();
  if (!user || !profile?.is_active) return null;
  const requestNow = new Date().getTime();

  // Profile RLS exposes only the current profile to ordinary users. This
  // authenticated server page uses the admin client to build complete tables,
  // then applies stricter pick-visibility filtering below.
  const admin = createAdminClient();
  const { data: season, error: seasonError } = await admin
    .from("seasons")
    .select("id, name")
    .eq("is_active", true)
    .maybeSingle();
  if (seasonError || !season) {
    return <section className="brand-card p-5 sm:p-7"><p className="brand-eyebrow">Competition</p><h1 className="brand-title mt-2">Tables</h1><p className="brand-subtitle mt-3">There is no active season available.</p></section>;
  }

  const [{ data: profileRows }, { data: matchdayRows }, { data: competitionRows }] = await Promise.all([
    admin.from("profiles").select("id, display_name").eq("is_active", true).order("display_name"),
    admin.from("matchdays").select("id, matchday_number, status, locks_at").eq("season_id", season.id).order("matchday_number"),
    admin.from("competitions").select("id, name, start_matchday, end_matchday, status").eq("season_id", season.id).order("start_matchday"),
  ]);
  const profiles = (profileRows ?? []) as Profile[];
  const matchdays = (matchdayRows ?? []) as Matchday[];
  const competitions = (competitionRows ?? []) as Competition[];
  const matchdayIds = matchdays.map((matchday) => matchday.id);
  const { data: entryRows } = matchdayIds.length
    ? await admin.from("entries").select("id, user_id, matchday_id, total_goals_prediction, submitted_at, calculated_score, score_calculated_at").in("matchday_id", matchdayIds)
    : { data: [] };
  const entries = (entryRows ?? []) as Entry[];
  const matchdayById = new Map(matchdays.map((matchday) => [matchday.id, matchday]));
  const currentMatchday = resolveCurrentMatchday(matchdays, requestNow);
  const currentCompetition = resolveCurrentCompetition(competitions, currentMatchday);
  const competitionRowsBuilt = currentCompetition
    ? buildStandings(profiles, entries, matchdayById, {
        start: currentCompetition.start_matchday,
        end: currentCompetition.end_matchday,
      })
    : [];
  const overallRows = buildStandings(profiles, entries, matchdayById);
  const selectedMatchday =
    (/^\d+$/.test(params.matchday ?? "")
      ? matchdays.find(
          (matchday) => matchday.matchday_number === Number(params.matchday),
        )
      : null) ??
    currentMatchday ??
    matchdays.at(-1) ??
    null;

  const tabs: Array<{ key: View; label: string }> = [
    { key: "competition", label: "Current Competition" },
    { key: "overall", label: "Overall" },
    { key: "matchday", label: "Matchday Breakdown" },
  ];

  let breakdown: React.ReactNode = null;
  if (view === "matchday" && selectedMatchday) {
    const breakdownEntryIds = entries
      .filter((entry) => entry.matchday_id === selectedMatchday.id)
      .map((entry) => entry.id);
    const [{ data: fixtures }, { data: selections }] = await Promise.all([
      admin.from("fixtures").select("id, home_team_name, away_team_name, home_team_crest_url, away_team_crest_url, kickoff_at, status, home_score, away_score").eq("matchday_id", selectedMatchday.id).order("kickoff_at"),
      breakdownEntryIds.length
        ? supabase.from("entry_selections").select("id, entry_id, category, fixture_id, selected_team_side, points_awarded, is_correct").in("entry_id", breakdownEntryIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const fixtureRows = fixtures ?? [];
    const sharedBreakdown = buildMatchdayBreakdown({
      matchday: selectedMatchday,
      profiles,
      entries,
      selections: selections ?? [],
      fixtures: fixtureRows,
      viewerId: user.id,
      now: requestNow,
    });

    breakdown = (
      <div className="space-y-5">
        {!sharedBreakdown.visibleToAll && !profile.is_admin ? <p className="brand-alert-warning">This matchday has not locked. Only your picks are visible.</p> : null}
        <p className="text-sm text-slate-400">Locks {formatDate(selectedMatchday.locks_at)}</p>
        <ReadOnlyMatchdayPicks matchday={selectedMatchday} fixtures={fixtureRows} players={sharedBreakdown.players} actualGoals={sharedBreakdown.actualGoals} finalReady={sharedBreakdown.finalReady} currentPlayerId={user.id} now={requestNow} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="brand-card p-5 sm:p-7"><p className="brand-eyebrow">{season.name}</p><h1 className="brand-title mt-2">Tables</h1><p className="brand-subtitle mt-2">Competition standings, overall scores, and locked-matchday picks.</p></header>
      <nav className="grid gap-2 sm:grid-cols-3" aria-label="Tables views">{tabs.map((tab) => <Link key={tab.key} href={`/tables?view=${tab.key}`} className={view === tab.key ? "brand-button-primary" : "brand-button-secondary"}>{tab.label}</Link>)}</nav>
      {view === "competition" ? currentCompetition ? <section className="space-y-4"><div><p className="brand-eyebrow">Current competition</p><h2 className="mt-1 text-2xl font-black text-white">{currentCompetition.name}</h2></div><StandingsTable rows={competitionRowsBuilt} latestColumn="latest" /></section> : <p className={profile.is_admin ? "brand-alert-warning" : "brand-card p-5 text-sm text-slate-300"}>{profile.is_admin ? "No competition is configured for the active season. Refresh competitions from Admin." : "Competition standings are not configured yet. Overall and Matchday Breakdown remain available."}</p> : null}
      {view === "overall" ? <section className="space-y-4"><div><p className="brand-eyebrow">Season standings</p><h2 className="mt-1 text-2xl font-black text-white">Overall</h2><p className="mt-1 text-sm text-slate-400">Submitted entries with finalized scores only · standard tied ranking.</p></div><StandingsTable rows={overallRows} latestColumn="average" /></section> : null}
      {view === "matchday" ? selectedMatchday ? <><div className="brand-card p-4"><MatchdaySelectNavigation currentMatchday={selectedMatchday.matchday_number} matchdays={matchdays.map((matchday) => ({ number: matchday.matchday_number, label: `Matchday ${matchday.matchday_number} · ${matchday.status}` }))} /></div>{breakdown}</> : <p className="brand-card p-5 text-sm text-slate-300">No matchdays are available for this season.</p> : null}
    </div>
  );
}
