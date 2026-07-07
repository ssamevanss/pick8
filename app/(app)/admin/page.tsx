export const dynamic = "force-dynamic";

import AdminAddFixtureForm from "@/components/admin/AdminAddFixtureForm";
import AdminExternalFixturePickerCard, {
  type AdminExternalFixtureOption,
} from "@/components/admin/AdminExternalFixturePickerCard";
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
import { createAdminClient } from "@/utils/supabase/admin";
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
  updateActiveSeasonProviderSettings,
  deleteSeason,
  recalculateActiveSeasonLeaderboard,
  rescoreActiveSeasonAndRecalculateLeaderboard,
} from "./actions";
import SubmitButton from "@/components/forms/SubmitButton";
import ToastTrigger from "@/components/toast/ToastTrigger";
import AdminSeasonSetupCard from "@/components/admin/AdminSeasonSetupCard";
import AdminSeasonControlsCard, {
  type AdminSeasonRow,
} from "@/components/admin/AdminSeasonControlsCard";
import AdminSeasonSettingsCard, {
  type AdminSeasonSettingsSeason,
} from "@/components/admin/AdminSeasonSettingsCard";
import AdminGameweekPickerAssignmentsCard, {
  type GameweekPickerAssignmentRow,
} from "@/components/admin/AdminGameweekPickerAssignmentsCard";
import AdminMaintenanceCards, {
  type ExternalFixtureReadinessRow,
  type HealthCheckRow,
  type MaintenanceSeasonOption,
  type ReminderReadinessRow,
} from "@/components/admin/AdminMaintenanceCards";
import {
  footballDataCompetitionOptions,
  getFootballDataCompetitionOption,
  type FootballCompetitionOption,
} from "@/utils/football-competitions";
import { getExternalFixtureGroupKey } from "@/utils/external-fixtures";
import {
  buildFixtureTimingWindow,
  formatTimingWindow,
} from "@/utils/fixture-timing-window";

type Profile = {
  id: string;
  display_name: string;
  email: string | null;
  role: string;
  status: string;
};

type AdminTab = "overview" | "users" | "season" | "gameweeks" | "maintenance";

type HealthFixtureRow = {
  id: string;
  gameweek_id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
  external_provider: string | null;
  external_fixture_id: string | null;
  external_last_synced_at: string | null;
};

type HealthPredictionRow = {
  fixture_id: string;
  points: number | null;
};

function getSelectedTab(tab: string | undefined): AdminTab {
  if (tab === "create") {
    return "season";
  }

  if (tab === "fixtures" || tab === "results") {
    return "gameweeks";
  }

  if (
    tab === "overview" ||
    tab === "users" ||
    tab === "season" ||
    tab === "gameweeks" ||
    tab === "maintenance"
  ) {
    return tab;
  }

  return "overview";
}

function getAdminSavedToastTitle(tab: string | undefined) {
  if (tab === "results") {
    return "Result updated";
  }

  if (tab === "users") {
    return "User updated";
  }

  if (tab === "maintenance") {
    return "Maintenance action completed";
  }

  if (tab === "season" || tab === "create") {
    return "Settings saved";
  }

  if (tab === "fixtures" || tab === "gameweeks") {
    return "Fixtures picked";
  }

  return "Settings saved";
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<{
    saved?: string;
    error?: string;
    gameweek?: string;
    tab?: string;
    competition?: string;
  }>;
}) {
  const params = searchParams ? await searchParams : {};
  const selectedTab = getSelectedTab(params.tab);
  const selectedGameweekId = params.gameweek;

  const supabase = await createClient();
  const adminSupabase = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user?.id)
    .single();

  if (profile?.role !== "admin" || profile.status !== "approved") {
    redirect("/dashboard?error=Admin access required");
  }

  const { data: activeSeason } = await getActiveSeason(
    supabase,
    "id, name, status, is_active, base_provider, base_competition_code, base_competition_name, base_competition_external_id, provider_season, fixture_import_enabled, result_sync_enabled",
  );

  const { data: seasons } = await supabase
    .from("seasons")
    .select(
      "id, name, status, is_active, season_type, description, show_in_archive, created_at, archived_at",
    )
    .order("created_at", { ascending: false });

  const seasonList = (seasons as AdminSeasonRow[] | null) ?? [];
  const { data: externalCompetitionRows } = await supabase
    .from("external_competitions")
    .select(
      "provider, external_competition_code, external_competition_id, name",
    )
    .eq("provider", "football_data")
    .eq("enabled", true)
    .order("display_order", { ascending: true });
  const externalCompetitionOptions =
    (
      (externalCompetitionRows as
        | {
            provider: string;
            external_competition_code: string;
            external_competition_id: string | null;
            name: string;
          }[]
        | null) ?? []
    )
      .map((row): FootballCompetitionOption | null => {
        const fallback = getFootballDataCompetitionOption(
          row.external_competition_code,
        );

        if (!fallback) {
          return null;
        }

        return {
          provider: "football_data",
          external_competition_code: row.external_competition_code,
          name: row.name || fallback.name,
          external_competition_id:
            row.external_competition_id ?? fallback.external_competition_id,
        };
      })
      .filter((option): option is FootballCompetitionOption => Boolean(option));
  const seasonSettingsCompetitionOptions =
    externalCompetitionOptions.length > 0
      ? externalCompetitionOptions
      : footballDataCompetitionOptions;

  const { data: gameweeks } = activeSeason
    ? await supabase
        .from("gameweeks")
        .select("id, gameweek_number, name, is_double_gameweek")
        .eq("season_id", activeSeason.id)
        .order("gameweek_number", { ascending: true })
    : { data: null };

  const gameweekList = (gameweeks ?? []) as Gameweek[];

  const gameweekIds = gameweekList.map((gameweek) => gameweek.id);

  const { data: fixtureRows } =
    gameweekIds.length > 0
      ? await supabase
          .from("fixtures")
          .select(
            "id, gameweek_id, home_team, away_team, kickoff_at, status, home_score, away_score, external_provider, external_fixture_id, external_last_synced_at",
          )
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
          is_double_gameweek,
          fixture_picker_id,
          fixtures (
            id,
            status,
            predictions (
              id
            )
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
          .select("fixture_id, points")
          .in("fixture_id", completedFixtureIds)
      : { data: [] };

  const unscoredCompletedPredictions = (
    (completedFixturePredictions as HealthPredictionRow[] | null) ?? []
  ).filter((prediction) => prediction.points === null);
  const unscoredPredictionCount = unscoredCompletedPredictions.length;
  const activeSeasonFixtureById = new Map(
    activeSeasonFixtures.map((fixture) => [fixture.id, fixture]),
  );
  const activeSeasonGameweekById = new Map(
    gameweekList.map((gameweek) => [gameweek.id, gameweek]),
  );
  const unscoredPredictionFixtureDetails = [
    ...new Map(
      unscoredCompletedPredictions.map((prediction) => {
        const fixture = activeSeasonFixtureById.get(prediction.fixture_id);
        const gameweek = fixture
          ? activeSeasonGameweekById.get(fixture.gameweek_id)
          : null;
        const label = fixture
          ? `${gameweek?.name ?? `Gameweek ${gameweek?.gameweek_number ?? "?"}`}: ${
              fixture.home_team
            } vs ${fixture.away_team}`
          : prediction.fixture_id;

        return [label, label];
      }),
    ).values(),
  ].slice(0, 3);

  const { count: leaderboardEntryCount } = activeSeason?.id
    ? await supabase
        .from("leaderboard_entries")
        .select("id", { count: "exact", head: true })
        .eq("season_id", activeSeason.id)
    : { count: 0 };

  const { count: reminderCount, error: reminderCountError } = await adminSupabase
    .from("email_notifications")
    .select("id", { count: "exact", head: true });

  const { data: latestReminder, error: latestReminderError } = await adminSupabase
    .from("email_notifications")
    .select("email_type, sent_at")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const typedLatestReminder = latestReminder as {
    email_type: string;
    sent_at: string;
  } | null;

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
      detail: envVar.present
        ? "Present in this runtime."
        : "Missing in this runtime. This does not check Vercel Production.",
    })),
    {
      label: "Reminder log",
      value: reminderCountError ? "Not ready" : "Ready",
      severity: reminderCountError ? "warning" : "ok",
      detail: reminderCountError
        ? reminderCountError.message
        : `${reminderCount ?? 0} sent email notification log rows.`,
    },
    {
      label: "Last reminder sent",
      value:
        latestReminderError || !typedLatestReminder
          ? "None"
          : `${typedLatestReminder.email_type} · ${new Intl.DateTimeFormat(
              "en-GB",
              {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              },
            ).format(new Date(typedLatestReminder.sent_at))}`,
      severity: latestReminderError ? "warning" : "ok",
      detail: latestReminderError
        ? latestReminderError.message
        : typedLatestReminder
          ? `Most recent email notification: ${typedLatestReminder.email_type}.`
          : "No email notification log rows yet.",
    },
  ];

  const activeSeasonExternalConfig = activeSeason as
    | {
        base_provider: string | null;
        base_competition_code: string | null;
        base_competition_name: string | null;
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
      detail: "Manual admin sync is available. Keep scheduled sync disabled until cron is added.",
    },
  ];

  const selectedExternalLinkedFixtures = activeSeasonFixtures.filter(
    (fixture) =>
      fixture.external_provider === "football_data" &&
      Boolean(fixture.external_fixture_id),
  );
  const lastExternalSyncAt =
    selectedExternalLinkedFixtures
      .map((fixture) => fixture.external_last_synced_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  const externalResultSyncSummary = {
    activeSeasonId: activeSeason?.id ?? null,
    activeSeasonName: activeSeason?.name ?? null,
    baseProvider: activeSeasonExternalConfig?.base_provider ?? null,
    baseCompetitionCode:
      activeSeasonExternalConfig?.base_competition_code ?? null,
    baseCompetitionName:
      activeSeasonExternalConfig?.base_competition_name ?? null,
    selectedExternalFixtureCount: selectedExternalLinkedFixtures.length,
    lastExternalSyncAt,
  };
  const adminExternalFixturesConfigured =
    activeSeasonExternalConfig?.base_provider === "football_data" &&
    Boolean(activeSeasonExternalConfig.base_competition_code);
  const selectedAdminCompetition =
    seasonSettingsCompetitionOptions.find(
      (competition) =>
        competition.external_competition_code === params.competition,
    ) ??
    seasonSettingsCompetitionOptions.find(
      (competition) =>
        competition.external_competition_code ===
        activeSeasonExternalConfig?.base_competition_code,
    ) ??
    seasonSettingsCompetitionOptions[0] ??
    null;
  const selectedAdminCompetitionCode =
    selectedAdminCompetition?.external_competition_code ??
    activeSeasonExternalConfig?.base_competition_code ??
    null;
  const nowIso = new Date().toISOString();
  const { data: adminExternalFixtureRows } =
    adminExternalFixturesConfigured && selectedAdminCompetitionCode
      ? await supabase
          .from("external_fixtures")
          .select(
            "id, provider, external_fixture_id, external_competition_code, external_round, external_matchday, external_stage, external_group, home_team, away_team, kickoff_at, status",
          )
          .eq("provider", "football_data")
          .eq("external_competition_code", selectedAdminCompetitionCode)
          .in("status", ["TIMED", "SCHEDULED"])
          .gt("kickoff_at", nowIso)
          .order("kickoff_at", { ascending: true })
      : { data: [] };
  const { data: adminBaseExternalFixtureRows } =
    adminExternalFixturesConfigured &&
    activeSeasonExternalConfig?.base_competition_code
      ? await supabase
          .from("external_fixtures")
          .select(
            "external_matchday, external_stage, kickoff_at",
          )
          .eq("provider", "football_data")
          .eq(
            "external_competition_code",
            activeSeasonExternalConfig.base_competition_code,
          )
          .in("status", ["TIMED", "SCHEDULED"])
          .gt("kickoff_at", nowIso)
          .order("kickoff_at", { ascending: true })
      : { data: [] };
  const adminBaseRows =
    (adminBaseExternalFixtureRows as
      | {
          external_matchday: number | null;
          external_stage: string | null;
          kickoff_at: string;
        }[]
      | null) ?? [];
  const adminBaseFirstGroupKey = adminBaseRows[0]
    ? getExternalFixtureGroupKey(adminBaseRows[0])
    : null;
  const adminTimingWindow = buildFixtureTimingWindow({
    selectedFixtureKickoffs: fixtureList.map((fixture) => fixture.kickoff_at),
    baseCompetitionKickoffs: adminBaseFirstGroupKey
      ? adminBaseRows
          .filter(
            (fixture) =>
              getExternalFixtureGroupKey(fixture) === adminBaseFirstGroupKey,
          )
          .map((fixture) => fixture.kickoff_at)
      : [],
  });
  const adminTimingWindowText = adminTimingWindow
    ? formatTimingWindow(adminTimingWindow)
    : null;
  const externalFixtureUsage = new Map<string, string>();

  for (const fixture of activeSeasonFixtures) {
    if (fixture.external_provider && fixture.external_fixture_id) {
      externalFixtureUsage.set(
        `${fixture.external_provider}:${fixture.external_fixture_id}`,
        fixture.gameweek_id,
      );
    }
  }

  const adminExternalFixtureOptions = (
    (adminExternalFixtureRows as
      | Omit<AdminExternalFixtureOption, "disabledReason">[]
      | null) ?? []
  ).map((fixture) => {
    const usedGameweekId = externalFixtureUsage.get(
      `${fixture.provider}:${fixture.external_fixture_id}`,
    );
    const usedInCurrentGameweek =
      selectedGameweek && usedGameweekId === selectedGameweek.id;
    const disabledReason = usedInCurrentGameweek
      ? "Already selected for this gameweek"
      : usedGameweekId
        ? "Already selected in another gameweek"
        : null;

    return {
      ...fixture,
      disabledReason,
    };
  });

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
      value: activeSeason ? String(unscoredPredictionCount) : "No active season",
      severity: !activeSeason
        ? "warning"
        : unscoredPredictionCount === 0
          ? "ok"
          : "warning",
      detail: activeSeason
        ? unscoredPredictionCount === 0
          ? `Active season only: ${activeSeason.name}.`
          : `Active season only: ${activeSeason.name}. ${unscoredPredictionFixtureDetails.join(
              "; ",
            )}${unscoredPredictionCount > unscoredPredictionFixtureDetails.length ? "; ..." : ""}`
        : "No active season to inspect.",
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
      <header className="brand-card p-5 sm:p-6">
        <p className="brand-eyebrow">Control room</p>
        <h1 className="brand-title mt-2">Admin</h1>
        <p className="brand-subtitle mt-2">
          Create gameweeks, manage fixtures, enter final results, and manage
          users.
        </p>
      </header>

      <AdminTabs
        selectedTab={selectedTab}
        selectedGameweekId={selectedGameweek?.id ?? null}
      />

      {params.saved ? (
        <ToastTrigger
          title={getAdminSavedToastTitle(params.tab)}
          triggerKey={`admin:${params.tab ?? selectedTab}:${params.saved}`}
        />
      ) : null}

      {params.error ? (
        <p className="brand-alert-danger mt-4">
          {params.error}
        </p>
      ) : null}

      {selectedTab === "overview" ? (
        <section className="mt-6 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="brand-card p-4 sm:p-5">
            <p className="brand-eyebrow">Active season</p>
            <h2 className="mt-2 text-2xl font-bold">
              {activeSeason?.name ?? "No active season"}
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="brand-card-soft p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Status
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {activeSeason?.status ?? "Not set"}
                </p>
              </div>
              <div className="brand-card-soft p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Competition
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {activeSeasonExternalConfig?.base_competition_name ??
                    activeSeasonExternalConfig?.base_competition_code ??
                    "Not set"}
                </p>
              </div>
              <div className="brand-card-soft p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Fixture list
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {activeSeasonExternalConfig?.fixture_import_enabled
                    ? "Enabled"
                    : "Off"}
                </p>
              </div>
              <div className="brand-card-soft p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Result updates
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {activeSeasonExternalConfig?.result_sync_enabled
                    ? "Enabled"
                    : "Off"}
                </p>
              </div>
            </div>
          </div>

          <div className="brand-card p-4 sm:p-5">
            <p className="brand-eyebrow">Quick health</p>
            <div className="mt-4 space-y-3">
              {healthChecks.slice(0, 5).map((check) => (
                <div
                  key={check.label}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2"
                >
                  <span className="text-sm text-slate-300">{check.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      check.severity === "ok"
                        ? "bg-emerald-400/10 text-emerald-300"
                        : check.severity === "warning"
                          ? "bg-amber-300/10 text-amber-300"
                          : "bg-red-400/10 text-red-300"
                    }`}
                  >
                    {check.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {selectedTab === "season" ? (
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

          <AdminSeasonSettingsCard
            activeSeason={
              (activeSeason as AdminSeasonSettingsSeason | null) ?? null
            }
            competitionOptions={seasonSettingsCompetitionOptions}
            action={updateActiveSeasonProviderSettings}
          />
        </>
      ) : null}

      {selectedTab === "gameweeks" ? (
        <section className="brand-card mt-6 p-4 sm:p-5">
          <AdminSeasonSetupCard
            activeSeasonId={activeSeason?.id ?? null}
            activeSeasonName={activeSeason?.name ?? null}
            existingGameweekCount={gameweekList.length}
            action={generateMissingGameweeks}
          />

          <div className="mt-6">
            <AdminGameweekPickerAssignmentsCard
              activeSeasonId={activeSeason?.id ?? null}
              gameweeks={gameweekPickerAssignmentList}
              profiles={(profiles as Profile[] | null) ?? []}
              saveAction={saveGameweekPickerAssignments}
              autoAssignAllAction={autoAssignAllGameweekPickers}
              autoAssignFutureAction={autoAssignFutureGameweekPickers}
            />
          </div>

          <div className="mt-6">
          <GameweekSelector
            gameweeks={gameweekList}
            selectedGameweekId={selectedGameweek?.id ?? null}
            basePath="/admin?tab=gameweeks"
          />
          </div>

          <h2 className="mt-5 text-xl font-semibold">Manage fixtures</h2>
          <p className="mt-2 text-sm text-slate-400">
            Edit teams, kickoff times, and competitions for the selected
            gameweek.
          </p>

          {error ? (
            <p className="brand-alert-danger mt-4">
              {error.message}
            </p>
          ) : null}

          {!error && fixtureList.length === 0 ? (
            <p className="brand-card-soft mt-4 p-4 text-sm text-slate-400">
              No fixtures found for this gameweek.
            </p>
          ) : null}

          <div className="mt-4 space-y-3">
            {fixtureList.map((fixture) => (
              <AdminManageFixtureCard key={fixture.id} fixture={fixture} />
            ))}

            <AdminExternalFixturePickerCard
              gameweekId={selectedGameweek?.id ?? null}
              configured={adminExternalFixturesConfigured}
              provider={activeSeasonExternalConfig?.base_provider ?? null}
              competitionCode={
                selectedAdminCompetitionCode
              }
              competitionName={
                selectedAdminCompetition?.name ??
                activeSeasonExternalConfig?.base_competition_name ??
                null
              }
              baseCompetitionCode={
                activeSeasonExternalConfig?.base_competition_code ?? null
              }
              competitionOptions={seasonSettingsCompetitionOptions}
              timingWindowText={adminTimingWindowText}
              timingWindow={adminTimingWindow}
              fixtures={adminExternalFixtureOptions}
            />

            <AdminAddFixtureForm
              gameweekId={selectedGameweek?.id ?? null}
              timingWindowText={adminTimingWindowText}
              defaultCompetitionName={
                activeSeasonExternalConfig?.base_competition_name ?? null
              }
            />
          </div>
          <details className="brand-card mt-6 p-4">
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

          <div className="mt-8 border-t border-white/10 pt-6">
          <h2 className="text-xl font-semibold">Enter results</h2>
          <p className="mt-2 text-sm text-slate-400">
            Add final scores for the selected gameweek. This will calculate
            prediction points and update the leaderboard.
          </p>

          {error ? (
            <p className="brand-alert-danger mt-4">
              {error.message}
            </p>
          ) : null}

          {!error && fixtureList.length === 0 ? (
            <p className="brand-card-soft mt-4 p-4 text-sm text-slate-400">
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
          </div>
        </section>
      ) : null}

      {selectedTab === "users" ? (
        <section className="brand-card mt-6 p-4 sm:p-5">
          <h2 className="text-xl font-semibold">Users</h2>
          <p className="mt-2 text-sm text-slate-400">
            Review account requests and manage display names and roles for league
            members.
          </p>

          {adminUsersError ? (
            <p className="brand-alert-danger mt-4">
              {adminUsersError.message}
            </p>
          ) : null}

          {!adminUsersError && userList.length === 0 ? (
            <p className="brand-card-soft mt-4 p-4 text-sm text-slate-400">
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
          externalResultSyncSummary={externalResultSyncSummary}
          recalculateAction={recalculateActiveSeasonLeaderboard}
          rescoreAction={rescoreActiveSeasonAndRecalculateLeaderboard}
        />
      ) : null}
    </>
  );
}
