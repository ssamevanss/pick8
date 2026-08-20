import { getRequestAuthContext } from "@/utils/app-context";
import { createAdminClient } from "@/utils/supabase/admin";
import MatchdayEntryForm, { type PickFixture } from "@/components/picks/MatchdayEntryForm";
import ReadOnlyMatchdayPicks from "@/components/picks/ReadOnlyMatchdayPicks";
import MatchdaySelectNavigation from "@/components/picks/MatchdaySelectNavigation";
import {
  buildMatchdayBreakdown,
  resolveDefaultPicksMatchday,
  type BreakdownEntry,
  type BreakdownFixture,
  type BreakdownMatchday,
  type BreakdownProfile,
  type BreakdownSelection,
} from "@/utils/pick8-matchday-breakdown";
import {
  earliestFixtureKickoff,
  isInitialPick8EntryWindowOpen,
} from "@/utils/pick8-fixture-state";
import { playerMatchdayLifecycle } from "@/utils/pick8-standings";

function formatDateTime(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
  }).format(new Date(value));
}

export default async function MyPicksPage({
  searchParams,
}: {
  searchParams?: Promise<{ matchday?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const { supabase, user, profile } = await getRequestAuthContext();
  if (!user || !profile?.is_active) return null;

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, name")
    .eq("is_active", true)
    .maybeSingle();
  if (seasonError || !season) {
    return <section className="brand-card p-5 sm:p-7"><p className="brand-eyebrow">Competition</p><h1 className="brand-title mt-2">My Picks</h1><p className="brand-subtitle mt-3">There is no active Pick8 season available.</p></section>;
  }

  const admin = createAdminClient();
  const { data: matchdayRows, error: matchdayError } = await admin
    .from("matchdays")
    .select("id, matchday_number, status, locks_at")
    .eq("season_id", season.id)
    .order("matchday_number");
  if (matchdayError) {
    return <section className="brand-card p-5 sm:p-7"><p className="brand-eyebrow">{season.name}</p><h1 className="brand-title mt-2">My Picks</h1><p className="brand-alert-danger mt-4">Matchdays could not be loaded.</p></section>;
  }
  const matchdays = (matchdayRows ?? []) as BreakdownMatchday[];
  const now = new Date().getTime();
  const defaultMatchday = resolveDefaultPicksMatchday(matchdays, now);
  const requestedNumber = /^\d+$/.test(params.matchday ?? "")
    ? Number(params.matchday)
    : null;
  const selectedMatchday =
    (requestedNumber !== null
      ? matchdays.find((matchday) => matchday.matchday_number === requestedNumber)
      : null) ??
    defaultMatchday;

  if (!selectedMatchday) {
    return <section className="brand-card p-5 sm:p-7"><p className="brand-eyebrow">{season.name}</p><h1 className="brand-title mt-2">My Picks</h1><p className="brand-subtitle mt-3">No matchdays are available for this season.</p></section>;
  }

  const [{ data: fixtureRows }, { data: profileRows }, { data: entryRows }] = await Promise.all([
    admin.from("fixtures").select("id, home_team_name, away_team_name, home_team_crest_url, away_team_crest_url, kickoff_at, status, home_score, away_score").eq("matchday_id", selectedMatchday.id).order("kickoff_at"),
    admin.from("profiles").select("id, display_name, is_active, pick8_participation_active").order("display_name"),
    admin.from("entries").select("id, user_id, matchday_id, total_goals_prediction, submitted_at, calculated_score, score_calculated_at").eq("matchday_id", selectedMatchday.id),
  ]);
  const fixtures = (fixtureRows ?? []) as BreakdownFixture[];
  const effectiveLocksAt = earliestFixtureKickoff(fixtures) ?? selectedMatchday.locks_at;
  const allProfiles = profileRows ?? [];
  const entries = (entryRows ?? []) as BreakdownEntry[];
  const profiles = allProfiles
    .filter((item) =>
      (item.is_active && item.pick8_participation_active) ||
      entries.some((entry) => entry.user_id === item.id),
    ) as BreakdownProfile[];
  const entryIds = entries.map((entry) => entry.id);
  const { data: selectionRows } = entryIds.length
    ? await supabase.from("entry_selections").select("id, entry_id, category, fixture_id, selected_team_side, points_awarded, is_correct").in("entry_id", entryIds)
    : { data: [] };
  const selections = (selectionRows ?? []) as BreakdownSelection[];
  const participationActive = profile.pick8_participation_active;
  const initialSubmissionWindowOpen = participationActive && isInitialPick8EntryWindowOpen(selectedMatchday.status, effectiveLocksAt, now);
  const ownEntry = entries.find((entry) => entry.user_id === user.id) ?? null;
  const ownSelections = ownEntry
    ? selections.filter((selection) => selection.entry_id === ownEntry.id)
    : [];
  const canEditSubmittedEntry = initialSubmissionWindowOpen && Boolean(ownEntry?.submitted_at);
  const showEntryEditor =
    effectiveLocksAt !== null &&
    (initialSubmissionWindowOpen || canEditSubmittedEntry);
  const matchdayUnderway = fixtures.some(
    (fixture) => now >= Date.parse(fixture.kickoff_at),
  );
  const lifecycleLabel = playerMatchdayLifecycle(selectedMatchday, now);
  const entryLabel = ownEntry?.submitted_at
    ? "Submitted"
    : ownEntry
      ? "Draft — Not submitted"
      : "Not started";
  const breakdown = buildMatchdayBreakdown({
    matchday: selectedMatchday,
    profiles,
    entries,
    selections,
    fixtures,
    viewerId: user.id,
    now,
  });
  const fixtureSlate = (
    <ReadOnlyMatchdayPicks
      key={`fixture-slate-${selectedMatchday.id}`}
      matchday={selectedMatchday}
      fixtures={fixtures}
      players={breakdown.players}
      actualGoals={breakdown.actualGoals}
      finalReady={breakdown.finalReady}
      currentPlayerId={user.id}
      showPlayers={false}
      showCurrentPlayerSummary={!ownEntry?.submitted_at}
      now={now}
    />
  );

  return (
    <div className="space-y-6">
      <header className="brand-card p-5 sm:p-7">
        <p className="brand-eyebrow">{season.name}</p>
        <div className="mt-2 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div><h1 className="brand-title">Matchday {selectedMatchday.matchday_number}</h1><p className="brand-subtitle mt-2">{matchdayUnderway ? "Initial submissions closed · Matchday in progress" : `Initial submission locks ${formatDateTime(effectiveLocksAt)} Melbourne time`}</p><span className="brand-pill mt-3">{lifecycleLabel} · {entryLabel}</span></div>
          <MatchdaySelectNavigation
            currentMatchday={selectedMatchday.matchday_number}
            matchdays={matchdays.map((matchday) => ({ number: matchday.matchday_number, label: `Matchday ${matchday.matchday_number} · ${matchday.status}` }))}
          />
        </div>
      </header>

      {!participationActive ? <p className="brand-alert-warning">Your Pick8 participation is paused. Historical entries and scores remain available, but you cannot submit or edit open matchdays.</p> : null}

      {effectiveLocksAt && ownEntry?.submitted_at ? (
        <MatchdayEntryForm
          matchdayId={selectedMatchday.id}
          locksAt={effectiveLocksAt}
          fixtures={fixtures.map((fixture): PickFixture => ({ id: fixture.id, homeTeamName: fixture.home_team_name, awayTeamName: fixture.away_team_name, homeTeamCrestUrl: fixture.home_team_crest_url, awayTeamCrestUrl: fixture.away_team_crest_url, kickoffAt: fixture.kickoff_at, status: fixture.status, homeScore: fixture.home_score, awayScore: fixture.away_score }))}
          initialSelections={ownSelections.map((selection) => ({ category: selection.category, fixtureId: selection.fixture_id, selectedTeamSide: selection.selected_team_side, pointsAwarded: selection.points_awarded }))}
          initialTotalGoals={ownEntry?.total_goals_prediction ?? null}
          initiallyEditable={canEditSubmittedEntry}
          initiallySubmitted
          initiallySubmittedAt={ownEntry.submitted_at}
          initiallyHasEntry
          actualGoals={breakdown.actualGoals}
          finalReady={breakdown.finalReady}
          finalMatchdayScore={ownEntry.calculated_score}
          totalGoalsPoints={breakdown.players.find(({ player }) => player.id === user.id)?.totalGoalsPoints ?? null}
          fixtureSlate={fixtureSlate}
        />
      ) : showEntryEditor && effectiveLocksAt ? (
        <MatchdayEntryForm
          matchdayId={selectedMatchday.id}
          locksAt={effectiveLocksAt}
          fixtures={fixtures.map((fixture): PickFixture => ({ id: fixture.id, homeTeamName: fixture.home_team_name, awayTeamName: fixture.away_team_name, homeTeamCrestUrl: fixture.home_team_crest_url, awayTeamCrestUrl: fixture.away_team_crest_url, kickoffAt: fixture.kickoff_at, status: fixture.status, homeScore: fixture.home_score, awayScore: fixture.away_score }))}
          initialSelections={ownSelections.map((selection) => ({ category: selection.category, fixtureId: selection.fixture_id, selectedTeamSide: selection.selected_team_side, pointsAwarded: selection.points_awarded }))}
          initialTotalGoals={ownEntry?.total_goals_prediction ?? null}
          initiallyEditable={initialSubmissionWindowOpen}
          initiallySubmitted={false}
          initiallySubmittedAt={null}
          initiallyHasEntry={Boolean(ownEntry)}
          actualGoals={breakdown.actualGoals}
          finalReady={breakdown.finalReady}
          finalMatchdayScore={ownEntry?.calculated_score ?? null}
          totalGoalsPoints={breakdown.players.find(({ player }) => player.id === user.id)?.totalGoalsPoints ?? null}
        />
      ) : (
        <>
          {!breakdown.visibleToAll ? <p className="brand-alert-warning">This matchday has not locked. Only your picks are visible.</p> : null}
          {fixtureSlate}
        </>
      )}
    </div>
  );
}
