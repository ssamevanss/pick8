import Link from "next/link";
import { redirect } from "next/navigation";
import { getRequestAuthContext } from "@/utils/app-context";
import { createInteractiveAdminClient } from "@/utils/supabase/admin";
import MatchdayEntryForm from "@/components/picks/MatchdayEntryForm";
import { normalizePick8RulesVersion } from "@/utils/pick8-rules";
import { getPick8EntryState, PICK8_ENTRY_STATE_LABELS } from "@/utils/pick8-entry-validation";
import { effectiveEntryDeadline } from "@/utils/pick8-fixture-state";
import { calculateCompletedMatchdayGoalTotal, isMatchdayReadyForFinalScoring } from "@/utils/pick8-scoring";
import { scorePick8TotalGoals } from "@/utils/pick8-scoring-rules";
import { saveAdminPickEntry } from "./actions";

export default async function AdminEntryPage({ searchParams }: { searchParams: Promise<{ player?: string; matchday?: string; saved?: string }> }) {
  const { user, profile, requestDeadlineSignal } = await getRequestAuthContext();
  if (!user || !profile?.is_active || !profile.is_admin) redirect("/dashboard?error=Admin+access+required");
  const params = await searchParams;
  const admin = createInteractiveAdminClient({ overallSignal: requestDeadlineSignal, context: { page: "admin.entries" } });
  const [{ data: player, error: playerError }, { data: md, error: mdError }, { data: fixtures, error: fixtureError }, { data: entry, error: entryError }] = await Promise.all([
    admin.from("profiles").select("id,display_name").eq("id", params.player ?? "").maybeSingle(),
    admin.from("matchdays").select("id,matchday_number,status,locks_at,pick8_rules_version").eq("id", params.matchday ?? "").maybeSingle(),
    admin.from("fixtures").select("id,home_team_name,away_team_name,home_team_crest_url,away_team_crest_url,kickoff_at,status,home_score,away_score,voided_at").eq("matchday_id", params.matchday ?? "").order("kickoff_at"),
    admin.from("entries").select("id,submitted_at,total_goals_prediction,updated_at,calculated_score").eq("user_id", params.player ?? "").eq("matchday_id", params.matchday ?? "").maybeSingle(),
  ]);
  if (playerError || mdError || fixtureError || entryError || !player || !md || !fixtures) return <p className="brand-alert-danger">Player entry could not be loaded. Return to administration and try again.</p>;
  const adminHref = `/admin?matchday=${md.matchday_number}`;
  if (!fixtures.length) return <div className="space-y-4">
    <Link href={adminHref} className="text-sky-300 underline">Back to administration</Link>
    <h1 className="brand-title">{player.display_name} · Matchday {md.matchday_number}</h1>
    <p className="brand-alert-warning">Fixtures have not been populated for this matchday yet. Picks can be entered once fixtures are available.</p>
  </div>;
  const { data: selections, error } = entry ? await admin.from("entry_selections").select("category,fixture_id,selected_team_side,points_awarded").eq("entry_id", entry.id) : { data: [], error: null };
  if (error) return <p className="brand-alert-danger">Saved selections could not be loaded.</p>;
  const finalReady = isMatchdayReadyForFinalScoring(fixtures);
  const actualGoals = calculateCompletedMatchdayGoalTotal(fixtures);
  const deadline = effectiveEntryDeadline(md.locks_at, fixtures) ?? "";
  const postLock = ["scoring", "completed"].includes(md.status);
  const href = `/admin/entries?player=${player.id}&matchday=${md.id}`;
  return <div className="space-y-5"><Link href={adminHref} className="text-sky-300 underline">Back to administration</Link>
    <h1 className="brand-title">{player.display_name} · Matchday {md.matchday_number}</h1>
    <p className="text-slate-300">Current status: <strong>{PICK8_ENTRY_STATE_LABELS[getPick8EntryState(entry)]}</strong></p>
    {params.saved ? <p className="brand-alert-success">Entry saved and audited.{params.saved === "pending" ? " Scoring is pending; use normal score recalculation if needed." : ""}</p> : null}
    <MatchdayEntryForm matchdayId={md.id} rulesVersion={normalizePick8RulesVersion(md.pick8_rules_version)} reloadHref={href}
      locksAt={deadline} fixtures={fixtures.map(f => ({ id: f.id, homeTeamName: f.home_team_name, awayTeamName: f.away_team_name, homeTeamCrestUrl: f.home_team_crest_url, awayTeamCrestUrl: f.away_team_crest_url, kickoffAt: f.kickoff_at, status: f.status, homeScore: f.home_score, awayScore: f.away_score }))}
      initialSelections={(selections ?? []).map(s => ({ category: s.category, fixtureId: s.fixture_id, selectedTeamSide: s.selected_team_side, pointsAwarded: s.points_awarded }))}
      initialTotalGoals={entry?.total_goals_prediction ?? null} initiallyEditable initiallySubmitted={Boolean(entry?.submitted_at)} initiallySubmittedAt={entry?.submitted_at ?? null} initiallyHasEntry={Boolean(entry)}
      actualGoals={actualGoals} finalReady={finalReady} finalMatchdayScore={entry?.calculated_score ?? null} totalGoalsPoints={scorePick8TotalGoals({ prediction: entry?.total_goals_prediction ?? null, actualGoals, finalScoringReady: finalReady })}
      adminContext={{ playerId: player.id, playerName: player.display_name, expectedUpdatedAt: entry?.updated_at ?? null, postLock }} saveAction={saveAdminPickEntry} />
  </div>;
}
