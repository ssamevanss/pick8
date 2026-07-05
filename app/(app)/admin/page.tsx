export const dynamic = "force-dynamic";

import AdminAddFixtureForm from "@/components/admin/AdminAddFixtureForm";
import AdminCreateGameweekForm from "@/components/admin/AdminCreateGameweekForm";
import AdminManageFixtureCard from "@/components/admin/AdminManageFixtureCard";
import AdminResultFixtureCard from "@/components/admin/AdminResultFixtureCard";
import AdminTabs from "@/components/admin/AdminTabs";
import AdminUserCard, {
  type AdminUser,
} from "@/components/admin/AdminUserCard";
import GameweekSelector from "@/components/gameweeks/GameweekSelector";
import type { Fixture, Gameweek } from "@/components/predictions/types";
import { createClient } from "@/utils/supabase/server";
import { getActiveSeason } from "@/utils/seasons";
import { redirect } from "next/navigation";
import {
  activateSeason,
  archiveSeason,
  createGameweekWithFixtures,
  createSeason,
  updateFixtureResults,
  generateMissingGameweeks,
  restoreSeasonToDraft,
  saveGameweekPickerAssignments,
  autoAssignAllGameweekPickers,
  autoAssignFutureGameweekPickers,
  updateSeasonArchiveVisibility,
  deleteSeason,
  recalculateActiveSeasonLeaderboard,
  rescoreActiveSeasonAndRecalculateLeaderboard,
} from "./actions";
import SubmitButton from "@/components/forms/SubmitButton";
import AdminSeasonSetupCard from "@/components/admin/AdminSeasonSetupCard";
import AdminSeasonControlsCard, {
  type AdminSeasonRow,
} from "@/components/admin/AdminSeasonControlsCard";
import AdminGameweekPickerAssignmentsCard, {
  type GameweekPickerAssignmentRow,
} from "@/components/admin/AdminGameweekPickerAssignmentsCard";
import AdminMaintenanceCards, {
  type ExternalFixtureReadinessRow,
  type HealthCheckRow,
  type MaintenanceSeasonOption,
  type ReminderReadinessRow,
} from "@/components/admin/AdminMaintenanceCards";

type Profile = {
  id: string;
  display_name: string;
  email: string | null;
  role: string;
  status: string;
};

type AdminTab = "create" | "fixtures" | "results" | "users" | "maintenance";

type HealthFixtureRow = {
  id: string;
  gameweek_id: string;
  kickoff_at: string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
};

type HealthPredictionRow = {
  points: number | null;
};

function getSelectedTab(tab: string | undefined): AdminTab {
  if (
    tab === "create" ||
    tab === "fixtures" ||
    tab === "results" ||
    tab === "users" ||
    tab === "maintenance"
  ) {
    return tab;
  }

  return "fixtures";
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<{
    saved?: string;
    error?: string;
    gameweek?: string;
    tab?: string;
  }>;
}) {
  const params = searchParams ? await searchParams : {};
  const selectedTab = getSelectedTab(params.tab);
  const selectedGameweekId = params.gameweek;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/dashboard?error=Admin access required");
  }

  const { data: activeSeason } = await getActiveSeason(
    supabase,
    "id, name, status, is_active, base_provider, base_competition_code, fixture_import_enabled, result_sync_enabled",
  );

  const { data: seasons } = await supabase
    .from("seasons")
    .select(
      "id, name, status, is_active, season_type, description, show_in_archive, created_at, archived_at",
    )
    .order("created_at", { ascending: false });

  const seasonList = (seasons as AdminSeasonRow[] | null) ?? [];

  const { data: gameweeks } = activeSeason
    ? await supabase
        .from("gameweeks")
        .select("id, gameweek_number, name")
        .eq("season_id", activeSeason.id)
        .order("gameweek_number", { ascending: true })
    : { data: null };

  const gameweekList = (gameweeks ?? []) as Gameweek[];

  const gameweekIds = gameweekList.map((gameweek) => gameweek.id);

  const { data: fixtureRows } =
    gameweekIds.length > 0
      ? await supabase
          .from("fixtures")
          .select("id, gameweek_id, kickoff_at, status, home_score, away_score")
          .in("gameweek_id", gameweekIds)
      : { data: [] };

  const gameweekIdsWithFixtures = new Set(
    (fixtureRows ?? []).map((fixture) => fixture.gameweek_id),
  );

  const activeSeasonFixtures =
    (fixtureRows as HealthFixtureRow[] | null) ?? [];
  const activeSeasonFixtureIds = activeSeasonFixtures.map(
    (fixture) => fixture.id,
  );

  const latestGameweekWithFixtures =
    [...gameweekList]
      .reverse()
      .find((gameweek) => gameweekIdsWithFixtures.has(gameweek.id)) ?? null;

  const selectedGameweek =
    gameweekList.find((gameweek) => gameweek.id === selectedGameweekId) ??
    latestGameweekWithFixtures ??
    gameweekList[gameweekList.length - 1] ??
    null;

  const nextGameweekNumber =
    gameweekList.length > 0
      ? Math.max(...gameweekList.map((gameweek) => gameweek.gameweek_number)) +
        1
      : 1;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, email, role, status")
    .order("display_name", { ascending: true });

  const { data: adminUsers, error: adminUsersError } = await supabase
    .from("profiles")
    .select("id, email, display_name, role, status")
    .order("status", { ascending: false })
    .order("display_name", { ascending: true });

  const { data: fixtures, error } = selectedGameweek
    ? await supabase
        .from("fixtures")
        .select(
          "id, gameweek_id, home_team, away_team, kickoff_at, competition, status, home_score, away_score",
        )
        .eq("gameweek_id", selectedGameweek.id)
        .order("kickoff_at", { ascending: true })
    : { data: null, error: null };

  const fixtureList = (fixtures as Fixture[] | null) ?? [];
  const userList = (adminUsers as AdminUser[] | null) ?? [];
  const pendingUsers = userList.filter((adminUser) => adminUser.status === "pending");
  const approvedUsers = userList.filter(
    (adminUser) => adminUser.status === "approved",
  );
  const rejectedUsers = userList.filter(
    (adminUser) => adminUser.status === "rejected",
  );
  const disabledUsers = userList.filter(
    (adminUser) => adminUser.status === "disabled",
  );

  const { data: gameweekPickerAssignments } = activeSeason?.id
    ? await supabase
        .from("gameweeks")
        .select(
          `
          id,
          gameweek_number,
          name,
          fixture_picker_id,
          fixtures (
            id
          )
        `,
        )
        .eq("season_id", activeSeason.id)
        .order("gameweek_number", { ascending: true })
    : { data: null };

  const gameweekPickerAssignmentList =
    (gameweekPickerAssignments as GameweekPickerAssignmentRow[] | null) ?? [];

  const { count: approvedUserCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("status", "approved");

  const { count: predictionCount } =
    activeSeasonFixtureIds.length > 0
      ? await supabase
          .from("predictions")
          .select("id", { count: "exact", head: true })
          .in("fixture_id", activeSeasonFixtureIds)
      : { count: 0 };

  const completedFixtureIds = activeSeasonFixtures
    .filter((fixture) => fixture.status === "completed")
    .map((fixture) => fixture.id);

  const { data: completedFixturePredictions } =
    completedFixtureIds.length > 0
      ? await supabase
          .from("predictions")
          .select("points")
          .in("fixture_id", completedFixtureIds)
      : { data: [] };

  const unscoredPredictionCount = (
    (completedFixturePredictions as HealthPredictionRow[] | null) ?? []
  ).filter((prediction) => prediction.points === null).length;

  const { count: leaderboardEntryCount } = activeSeason?.id
    ? await supabase
        .from("leaderboard_entries")
        .select("id", { count: "exact", head: true })
        .eq("season_id", activeSeason.id)
    : { count: 0 };

  const { count: reminderCount, error: reminderCountError } = await supabase
    .from("prediction_reminders")
    .select("id", { count: "exact", head: true });

  const { data: latestReminder, error: latestReminderError } = await supabase
    .from("prediction_reminders")
    .select("sent_at")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const typedLatestReminder = latestReminder as { sent_at: string } | null;

  const completedFixturesWithNullScores = activeSeasonFixtures.filter(
    (fixture) =>
      fixture.status === "completed" &&
      (fixture.home_score === null || fixture.away_score === null),
  ).length;

  const fixturesMissingKickoff = activeSeasonFixtures.filter(
    (fixture) => !fixture.kickoff_at,
  ).length;

  const activeSeasonIsConsistent =
    activeSeason?.status === "active" && activeSeason.is_active === true;

  const requiredEnvChecks = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "LEAGUE_SIGNUP_CODE",
  ].map((name) => ({
    name,
    present: Boolean(process.env[name]),
  }));

  const missingEnvVars = requiredEnvChecks
    .filter((envVar) => !envVar.present)
    .map((envVar) => envVar.name);

  const reminderEnvChecks = [
    "RESEND_API_KEY",
    "REMINDER_EMAIL_FROM",
    "CRON_SECRET",
  ].map((name) => ({
    name,
    present: Boolean(process.env[name]),
  }));

  const reminderReadiness: ReminderReadinessRow[] = [
    ...reminderEnvChecks.map((envVar) => ({
      label: envVar.name,
      value: envVar.present ? "Present" : "Missing",
      severity: envVar.present ? ("ok" as const) : ("warning" as const),
      detail:
        envVar.name === "CRON_SECRET"
          ? "Used to protect the Vercel Cron route."
          : "Required before real reminder emails can be sent.",
    })),
    {
      label: "Reminder log",
      value: reminderCountError ? "Not ready" : "Ready",
      severity: reminderCountError ? "warning" : "ok",
      detail: reminderCountError
        ? "Run the prediction_reminders SQL before enabling reminders."
        : `${reminderCount ?? 0} sent reminder log rows.`,
    },
    {
      label: "Last reminder sent",
      value:
        latestReminderError || !typedLatestReminder
          ? "None"
          : new Intl.DateTimeFormat("en-GB", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(typedLatestReminder.sent_at)),
      severity: latestReminderError ? "warning" : "ok",
      detail: latestReminderError
        ? "Run the prediction_reminders SQL before enabling reminders."
        : "Most recent prediction reminder log row.",
    },
  ];

  const activeSeasonExternalConfig = activeSeason as
    | {
        base_provider: string | null;
        base_competition_code: string | null;
        fixture_import_enabled: boolean | null;
        result_sync_enabled: boolean | null;
      }
    | null;

  const externalFixtureReadiness: ExternalFixtureReadinessRow[] = [
    {
      label: "FOOTBALL_DATA_API_KEY",
      value: process.env.FOOTBALL_DATA_API_KEY ? "Present" : "Missing",
      severity: process.env.FOOTBALL_DATA_API_KEY ? "ok" : "warning",
      detail: "Required for admin-only external fixture imports.",
    },
    {
      label: "Base provider",
      value: activeSeasonExternalConfig?.base_provider ?? "Not set",
      severity:
        activeSeasonExternalConfig?.base_provider === "football_data"
          ? "ok"
          : "warning",
      detail: "Active season should use football_data for the 2.0B import spike.",
    },
    {
      label: "Base competition",
      value: activeSeasonExternalConfig?.base_competition_code ?? "Not set",
      severity: activeSeasonExternalConfig?.base_competition_code
        ? "ok"
        : "warning",
      detail: "Examples: PL, PD, SA, BL1, FL1, WC.",
    },
    {
      label: "Fixture import",
      value: activeSeasonExternalConfig?.fixture_import_enabled
        ? "Enabled"
        : "Disabled",
      severity: activeSeasonExternalConfig?.fixture_import_enabled
        ? "ok"
        : "warning",
      detail: "Disabled by default. Dry-run remains available for configured seasons.",
    },
    {
      label: "Result sync",
      value: activeSeasonExternalConfig?.result_sync_enabled
        ? "Enabled"
        : "Disabled",
      severity: activeSeasonExternalConfig?.result_sync_enabled
        ? "warning"
        : "ok",
      detail: "Result sync is deferred until 2.0D.",
    },
  ];

  const healthChecks: HealthCheckRow[] = [
    {
      label: "Active season",
      value: activeSeason?.name ?? "Missing",
      severity: activeSeason ? "ok" : "error",
      detail: activeSeason?.id ?? "Create or activate a season.",
    },
    {
      label: "Season status mirror",
      value: activeSeasonIsConsistent ? "Consistent" : "Check needed",
      severity: activeSeasonIsConsistent
        ? "ok"
        : activeSeason
          ? "warning"
          : "error",
      detail: activeSeason
        ? `status=${activeSeason.status ?? "unknown"}, is_active=${
            activeSeason.is_active ? "true" : "false"
          }`
        : "No active season to compare.",
    },
    {
      label: "Approved users",
      value: String(approvedUserCount ?? 0),
      severity: (approvedUserCount ?? 0) > 0 ? "ok" : "warning",
    },
    {
      label: "Gameweeks",
      value: String(gameweekList.length),
      severity:
        gameweekList.length > 0 ? "ok" : activeSeason ? "warning" : "error",
      detail: "Active season only.",
    },
    {
      label: "Fixtures",
      value: String(activeSeasonFixtures.length),
      severity:
        activeSeasonFixtures.length > 0
          ? "ok"
          : activeSeason
            ? "warning"
            : "error",
      detail: "Active season only.",
    },
    {
      label: "Predictions",
      value: String(predictionCount ?? 0),
      severity: (predictionCount ?? 0) > 0 ? "ok" : "warning",
      detail: "Active season fixture predictions.",
    },
    {
      label: "Completed fixtures missing scores",
      value: String(completedFixturesWithNullScores),
      severity: completedFixturesWithNullScores === 0 ? "ok" : "error",
    },
    {
      label: "Fixtures missing kickoff",
      value: String(fixturesMissingKickoff),
      severity: fixturesMissingKickoff === 0 ? "ok" : "warning",
    },
    {
      label: "Unscored completed predictions",
      value: String(unscoredPredictionCount),
      severity: unscoredPredictionCount === 0 ? "ok" : "warning",
      detail: "Predictions on completed fixtures with null points.",
    },
    {
      label: "Leaderboard entries",
      value: String(leaderboardEntryCount ?? 0),
      severity: (leaderboardEntryCount ?? 0) > 0 ? "ok" : "warning",
      detail: "Active season only.",
    },
    {
      label: "Environment variables",
      value:
        missingEnvVars.length === 0
          ? "Present"
          : `${missingEnvVars.length} missing`,
      severity: missingEnvVars.length === 0 ? "ok" : "error",
      detail:
        missingEnvVars.length === 0
          ? "All required env vars are set."
          : missingEnvVars.join(", "),
    },
  ];

  const maintenanceSeasonOptions = seasonList.map((season) => ({
    id: season.id,
    name: season.name,
    status: season.status,
  })) as MaintenanceSeasonOption[];

  return (
    <>
      <h1 className="text-3xl font-bold">Admin</h1>
      <p className="mt-2 text-sm text-slate-400">
        Create gameweeks, manage fixtures, enter final results, and manage
        users.
      </p>

      <AdminTabs
        selectedTab={selectedTab}
        selectedGameweekId={selectedGameweek?.id ?? null}
      />

      {params.saved ? (
        <p className="mt-4 rounded-xl bg-emerald-950 p-3 text-sm text-emerald-300">
          Saved successfully.
        </p>
      ) : null}

      {params.error ? (
        <p className="mt-4 rounded-xl bg-red-950 p-3 text-sm text-red-300">
          {params.error}
        </p>
      ) : null}

      {selectedTab === "create" ? (
        <>
          <AdminSeasonControlsCard
            seasons={seasonList}
            createSeasonAction={createSeason}
            activateSeasonAction={activateSeason}
            archiveSeasonAction={archiveSeason}
            restoreSeasonAction={restoreSeasonToDraft}
            updateArchiveVisibilityAction={updateSeasonArchiveVisibility}
            deleteSeasonAction={deleteSeason}
          />

          <AdminSeasonSetupCard
            activeSeasonId={activeSeason?.id ?? null}
            activeSeasonName={activeSeason?.name ?? null}
            existingGameweekCount={gameweekList.length}
            action={generateMissingGameweeks}
          />

          <AdminGameweekPickerAssignmentsCard
            activeSeasonId={activeSeason?.id ?? null}
            gameweeks={gameweekPickerAssignmentList}
            profiles={(profiles as Profile[] | null) ?? []}
            saveAction={saveGameweekPickerAssignments}
            autoAssignAllAction={autoAssignAllGameweekPickers}
            autoAssignFutureAction={autoAssignFutureGameweekPickers}
          />
        </>
      ) : null}

      {selectedTab === "fixtures" ? (
        <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
          <GameweekSelector
            gameweeks={gameweekList}
            selectedGameweekId={selectedGameweek?.id ?? null}
            basePath="/admin?tab=fixtures"
          />

          <h2 className="text-xl font-semibold">Manage fixtures</h2>
          <p className="mt-2 text-sm text-slate-400">
            Edit teams, kickoff times, and competitions for the selected
            gameweek.
          </p>

          {error ? (
            <p className="mt-4 rounded-xl bg-red-950 p-4 text-sm text-red-300">
              {error.message}
            </p>
          ) : null}

          {!error && fixtureList.length === 0 ? (
            <p className="mt-4 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
              No fixtures found for this gameweek.
            </p>
          ) : null}

          <div className="mt-4 space-y-3">
            {fixtureList.map((fixture) => (
              <AdminManageFixtureCard key={fixture.id} fixture={fixture} />
            ))}

            <AdminAddFixtureForm gameweekId={selectedGameweek?.id ?? null} />
          </div>
          <details className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg">
            <summary className="cursor-pointer select-none text-sm font-semibold text-slate-300">
              Advanced: manually create a gameweek
            </summary>

            <div className="mt-4">
              <AdminCreateGameweekForm
                activeSeasonId={activeSeason?.id ?? null}
                nextGameweekNumber={nextGameweekNumber}
                profiles={(profiles as Profile[] | null) ?? []}
                action={createGameweekWithFixtures}
              />
            </div>
          </details>
        </section>
      ) : null}

      {selectedTab === "results" ? (
        <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
          <GameweekSelector
            gameweeks={gameweekList}
            selectedGameweekId={selectedGameweek?.id ?? null}
            basePath="/admin?tab=results"
          />

          <h2 className="text-xl font-semibold">Enter results</h2>
          <p className="mt-2 text-sm text-slate-400">
            Add final scores for the selected gameweek. This will calculate
            prediction points and update the leaderboard.
          </p>

          {error ? (
            <p className="mt-4 rounded-xl bg-red-950 p-4 text-sm text-red-300">
              {error.message}
            </p>
          ) : null}

          {!error && fixtureList.length === 0 ? (
            <p className="mt-4 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
              No fixtures found for this gameweek.
            </p>
          ) : null}

          <form action={updateFixtureResults} className="mt-4 space-y-3">
            {fixtureList.map((fixture) => (
              <AdminResultFixtureCard key={fixture.id} fixture={fixture} />
            ))}

            {fixtureList.length > 0 ? (
              <SubmitButton
                idleLabel="Save results"
                pendingLabel="Saving results..."
                className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950"
              />
            ) : null}
          </form>
        </section>
      ) : null}

      {selectedTab === "users" ? (
        <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
          <h2 className="text-xl font-semibold">Users</h2>
          <p className="mt-2 text-sm text-slate-400">
            Review account requests and manage display names and roles for league
            members.
          </p>

          {adminUsersError ? (
            <p className="mt-4 rounded-xl bg-red-950 p-4 text-sm text-red-300">
              {adminUsersError.message}
            </p>
          ) : null}

          {!adminUsersError && userList.length === 0 ? (
            <p className="mt-4 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
              No users found.
            </p>
          ) : null}

          <div className="mt-6 space-y-8">
            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">Pending approval</h3>
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300 ring-1 ring-amber-500/30">
                  {pendingUsers.length}
                </span>
              </div>

              {pendingUsers.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
                  No pending account requests.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {pendingUsers.map((adminUser) => (
                    <AdminUserCard
                      key={adminUser.id}
                      user={adminUser}
                      currentUserId={user!.id}
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">Approved users</h3>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                  {approvedUsers.length}
                </span>
              </div>

              {approvedUsers.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
                  No approved users.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {approvedUsers.map((adminUser) => (
                    <AdminUserCard
                      key={adminUser.id}
                      user={adminUser}
                      currentUserId={user!.id}
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">Disabled users</h3>
                <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-xs font-semibold text-slate-300 ring-1 ring-slate-500/30">
                  {disabledUsers.length}
                </span>
              </div>

              {disabledUsers.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
                  No disabled users.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {disabledUsers.map((adminUser) => (
                    <AdminUserCard
                      key={adminUser.id}
                      user={adminUser}
                      currentUserId={user!.id}
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">Rejected users</h3>
                <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-300 ring-1 ring-red-500/30">
                  {rejectedUsers.length}
                </span>
              </div>

              {rejectedUsers.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
                  No rejected users.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {rejectedUsers.map((adminUser) => (
                    <AdminUserCard
                      key={adminUser.id}
                      user={adminUser}
                      currentUserId={user!.id}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {selectedTab === "maintenance" ? (
        <AdminMaintenanceCards
          activeSeasonId={activeSeason?.id ?? null}
          activeSeasonName={activeSeason?.name ?? null}
          seasons={maintenanceSeasonOptions}
          healthChecks={healthChecks}
          reminderReadiness={reminderReadiness}
          externalFixtureReadiness={externalFixtureReadiness}
          recalculateAction={recalculateActiveSeasonLeaderboard}
          rescoreAction={rescoreActiveSeasonAndRecalculateLeaderboard}
        />
      ) : null}
    </>
  );
}
