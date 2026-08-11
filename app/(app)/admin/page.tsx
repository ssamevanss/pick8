import { redirect } from "next/navigation";
import { getRequestAuthContext, type Pick8Profile } from "@/utils/app-context";
import { updateProfile } from "./profile-actions";
import SubmitButton from "@/components/forms/SubmitButton";
import FixtureSyncCard from "@/components/admin/FixtureSyncCard";
import ScoreRecalculationCard from "@/components/admin/ScoreRecalculationCard";
import CompetitionRefreshCard from "@/components/admin/CompetitionRefreshCard";
import MatchdaySyncModeCard from "@/components/admin/MatchdaySyncModeCard";
import ManualMatchdayTestCard from "@/components/admin/ManualMatchdayTestCard";
import {
  acceleratedTestFixtureIds,
  MATCHDAY_2_TEST_ID,
} from "@/utils/pick8-manual-test";

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; saved?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const { supabase, user, profile } = await getRequestAuthContext();

  if (!user || !profile?.is_admin || !profile.is_active) {
    redirect("/dashboard?error=Admin+access+required");
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, email, display_name, is_admin, is_active, created_at, updated_at",
    )
    .order("display_name", { ascending: true });
  const profiles = (data as Pick8Profile[] | null) ?? [];
  const [{ data: seasonRows }, { data: matchdayRows }, { data: entryRows }, { data: fixtureRows }] = await Promise.all([
    supabase.from("seasons").select("id, name").order("provider_season", { ascending: false }),
    supabase.from("matchdays").select("id, season_id, matchday_number, status, fixture_sync_mode, is_accelerated_test").order("matchday_number", { ascending: true }),
    supabase.from("entries").select("matchday_id, submitted_at, calculated_score"),
    supabase.from("fixtures").select("matchday_id, kickoff_at, external_fixture_id"),
  ]);
  const seasonNameById = new Map((seasonRows ?? []).map((season) => [season.id, season.name]));
  const now = new Date().getTime();
  const acceleratedMatchdays = (matchdayRows ?? [])
    .filter((matchday) => matchday.is_accelerated_test)
    .sort((a, b) => a.matchday_number - b.matchday_number);
  const latestAccelerated = acceleratedMatchdays.at(-1);
  const testMatchdayNumber = latestAccelerated?.status === "completed"
    ? latestAccelerated.matchday_number + 1
    : latestAccelerated?.matchday_number ?? 3;
  const testMatchday = (matchdayRows ?? []).find(
    (matchday) => matchday.matchday_number === testMatchdayNumber,
  );
  const testFixtureIds = (fixtureRows ?? [])
    .filter((fixture) => fixture.matchday_id === testMatchday?.id)
    .map((fixture) => fixture.external_fixture_id)
    .sort();
  const expectedTestFixtureIds = acceleratedTestFixtureIds(testMatchdayNumber).sort();
  const testMatchdayExact = Boolean(testMatchday) &&
    testMatchday?.fixture_sync_mode === "manual" &&
    testMatchday.is_accelerated_test &&
    testFixtureIds.length === expectedTestFixtureIds.length &&
    testFixtureIds.every((id, index) => id === expectedTestFixtureIds[index]);
  const testMatchdayState = !testMatchday
    ? "missing" as const
    : !testMatchdayExact
      ? "unexpected" as const
      : testMatchday.status === "completed"
        ? "completed" as const
        : "ready" as const;

  return (
    <>
      <header className="brand-card mb-6 p-5 sm:p-6">
        <p className="brand-eyebrow">Administration</p>
        <h1 className="brand-title mt-2">Profiles</h1>
        <p className="brand-subtitle mt-2">
          Manage access, administrator privileges, and display names for the
          private Pick8 group. Set a recognisable display name for every player
          before activating their account; this is the name shown throughout Pick8.
        </p>
      </header>

      {params.error || error ? (
        <p className="brand-alert-danger mb-4">
          {params.error ?? error?.message}
        </p>
      ) : null}
      {params.saved ? (
        <p className="brand-alert-success mb-4">{params.saved === "fixture-mode" ? "Fixture sync mode saved." : "Profile saved."}</p>
      ) : null}

      <FixtureSyncCard />
      <MatchdaySyncModeCard matchdays={(matchdayRows ?? []).map((matchday) => ({
        id: matchday.id,
        number: matchday.matchday_number,
        seasonName: seasonNameById.get(matchday.season_id) ?? "Season",
        status: matchday.status,
        mode: matchday.fixture_sync_mode,
        canChange:
          !["locked", "scoring", "completed"].includes(matchday.status) &&
          !(fixtureRows ?? []).some((fixture) => fixture.matchday_id === matchday.id && Date.parse(fixture.kickoff_at) <= now) &&
          !(entryRows ?? []).some((entry) => entry.matchday_id === matchday.id && (entry.submitted_at !== null || entry.calculated_score !== null)),
      }))} />
      <CompetitionRefreshCard />
      <ManualMatchdayTestCard
        matchday2Available={(matchdayRows ?? []).some((matchday) => matchday.id === MATCHDAY_2_TEST_ID && matchday.fixture_sync_mode === "manual" && matchday.status !== "completed")}
        testMatchdayNumber={testMatchdayNumber}
        testMatchdayState={testMatchdayState}
      />
      <ScoreRecalculationCard
        seasons={(seasonRows ?? []).map((season) => ({ id: season.id, name: season.name }))}
        matchdays={(matchdayRows ?? []).map((matchday) => ({ id: matchday.id, seasonId: matchday.season_id, number: matchday.matchday_number, status: matchday.status }))}
      />

      <div className="space-y-4">
        {profiles.map((item) => {
          const isCurrentUser = item.id === user.id;

          return (
            <form key={item.id} action={updateProfile} className="brand-card p-4 sm:p-5">
              <input type="hidden" name="user_id" value={item.id} />
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                <div>
                  <label className="text-sm text-slate-300" htmlFor={`display-name-${item.id}`}>
                    Display name
                  </label>
                  <input
                    id={`display-name-${item.id}`}
                    name="display_name"
                    defaultValue={item.display_name}
                    placeholder="Enter the player's display name"
                    required
                    maxLength={80}
                    className="brand-input"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    {item.email ?? "No email"}{isCurrentUser ? " · This is you" : ""}
                  </p>
                </div>

                <label className="flex items-center gap-2 pb-2 text-sm font-semibold text-slate-200">
                  {isCurrentUser ? (
                    <input type="hidden" name="is_active" value="on" />
                  ) : null}
                  <input
                    type="checkbox"
                    name="is_active"
                    defaultChecked={item.is_active}
                    disabled={isCurrentUser}
                    className="h-5 w-5 accent-emerald-400"
                  />
                  Active
                </label>

                <label className="flex items-center gap-2 pb-2 text-sm font-semibold text-slate-200">
                  {isCurrentUser ? (
                    <input type="hidden" name="is_admin" value="on" />
                  ) : null}
                  <input
                    type="checkbox"
                    name="is_admin"
                    defaultChecked={item.is_admin}
                    disabled={isCurrentUser}
                    className="h-5 w-5 accent-emerald-400"
                  />
                  Admin
                </label>
              </div>

              <SubmitButton
                idleLabel="Save profile"
                pendingLabel="Saving..."
                className="brand-button-primary mt-4 w-full sm:w-auto"
              />
            </form>
          );
        })}

        {!error && profiles.length === 0 ? (
          <p className="brand-card p-5 text-sm text-slate-400">
            No profiles found.
          </p>
        ) : null}
      </div>
    </>
  );
}
