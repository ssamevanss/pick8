export const dynamic = "force-dynamic";

import AdminAddFixtureForm from "@/components/admin/AdminAddFixtureForm";
import AdminExternalFixturePickerCard, {
  type AdminExternalFixtureOption,
} from "@/components/admin/AdminExternalFixturePickerCard";
import AdminCreateGameweekForm from "@/components/admin/AdminCreateGameweekForm";
import AdminManageFixtureCard from "@/components/admin/AdminManageFixtureCard";
import AdminResultFixtureCard from "@/components/admin/AdminResultFixtureCard";
import AdminTabs from "@/components/admin/AdminTabs";
import AdminScopeSelector from "@/components/admin/AdminScopeSelector";
import AdminUserCard, {
  type AdminUser,
} from "@/components/admin/AdminUserCard";
import GameweekSelector from "@/components/gameweeks/GameweekSelector";
import type { Fixture, Gameweek } from "@/components/predictions/types";
import { createAdminClient } from "@/utils/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  activateSeason,
  archiveSeason,
  createGameweekWithFixtures,
  createSeason,
  rolloverActiveSeason,
  updateFixtureResults,
  generateMissingGameweeks,
  restoreSeasonToDraft,
  saveGameweekPickerAssignments,
  autoAssignAllGameweekPickers,
  autoAssignFutureGameweekPickers,
  updateSeasonArchiveVisibility,
  updateActiveSeasonProviderSettings,
  deleteSeason,
  createMaintenanceTestNotification,
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
import PlatformAdminOverview, {
  type PlatformLeagueOverviewRow,
  type PlatformSeasonOverviewRow,
} from "@/components/admin/PlatformAdminOverview";
import {
  canBrowseOtherCompetitions,
  footballDataCompetitionOptions,
  getFootballDataCompetitionOption,
  type FootballCompetitionOption,
} from "@/utils/football-competitions";
import { getExternalFixtureGroupKey } from "@/utils/external-fixtures";
import {
  buildFixtureTimingWindow,
  buildFixtureGroupTimings,
  formatTimingWindow,
  getSpecialFixtureCutoff,
  isKickoffBeforeSpecialFixtureCutoff,
} from "@/utils/fixture-timing-window";
import { getAppLeagueContext } from "@/utils/app-context";
import { logServerTiming, startServerTiming } from "@/utils/server-timing";

type Profile = {
  id: string;
  display_name: string;
  email: string | null;
  role: string;
  status: string;
};

type AdminTab = "overview" | "users" | "leagues" | "seasons" | "maintenance";

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

type PlatformLeagueDatabaseRow = {
  id: string;
  name: string;
  status: string;
  default_base_competition_name: string | null;
};

type PlatformSeasonDatabaseRow = {
  id: string;
  league_id: string | null;
  name: string;
  status: string;
  is_active: boolean | null;
  base_competition_name: string | null;
  base_competition_code: string | null;
  fixture_import_enabled: boolean | null;
  result_sync_enabled: boolean | null;
};

type PlatformMembershipDatabaseRow = {
  league_id: string;
  user_id: string;
  role: "player" | "league_admin";
  status: string;
};

type PlatformGameweekDatabaseRow = {
  id: string;
  season_id: string;
  gameweek_number: number;
  name: string | null;
  fixtures: { id: string; status: string }[] | null;
};

function getSelectedTab(tab: string | undefined): AdminTab {
  if (tab === "season" || tab === "create") {
    return "seasons";
  }

  if (tab === "gameweeks" || tab === "fixtures" || tab === "results") {
    return "maintenance";
  }

  if (
    tab === "overview" ||
    tab === "users" ||
    tab === "leagues" ||
    tab === "seasons" ||
    tab === "maintenance"
  ) {
    return tab;
  }

  return "overview";
}

function getAdminSavedToastTitle(
  tab: string | undefined,
  saved?: string,
) {
  if (saved === "season-archived") {
    return "Season archived";
  }

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

  if (tab === "gameweeks") {
    return "Gameweek settings saved";
  }

  if (tab === "fixtures") {
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
    league?: string;
    user_search?: string;
    user_status?: string;
    user_role?: string;
    user_league?: string;
  }>;
}) {
  const params = searchParams ? await searchParams : {};
  const pageStartedAt = startServerTiming();
  const selectedTab = getSelectedTab(params.tab);
  const selectedGameweekId = params.gameweek;

  const {
    user,
    profile,
    selectedLeague: shellSelectedLeague,
  } = await getAppLeagueContext();
  const adminSupabase = createAdminClient();

  if (profile?.role !== "admin" || profile.status !== "approved") {
    redirect("/dashboard?error=Admin access required");
  }

  let platformLeagueOverview: PlatformLeagueOverviewRow[] = [];
  let platformSeasonOverview: PlatformSeasonOverviewRow[] = [];
  let platformLeagueRows: PlatformLeagueDatabaseRow[] = [];
  let platformSeasonRows: (PlatformSeasonDatabaseRow & AdminSeasonRow)[] = [];
  let platformMembershipRows: PlatformMembershipDatabaseRow[] = [];
  let platformOverviewCounts = {
    approvedUsers: 0,
    pendingUsers: 0,
    disabledUsers: 0,
    activeLeagues: 0,
    activeSeasons: 0,
    leaguesWithoutActiveSeason: 0,
    upcomingUnpickedGameweeks: 0,
    openBugReports: null as number | null,
  };

  {
    const [
      { data: platformProfiles },
      { data: platformLeagues },
      { data: platformSeasons },
      { data: platformMemberships },
      bugReportResult,
    ] = await Promise.all([
      selectedTab === "overview"
        ? adminSupabase.from("profiles").select("id, status")
        : Promise.resolve({ data: [] }),
      adminSupabase
        .from("leagues")
        .select("id, name, status, default_base_competition_name")
        .order("name", { ascending: true }),
      adminSupabase
        .from("seasons")
        .select(
          "id, league_id, name, status, is_active, season_type, description, show_in_archive, provider_season, base_provider, base_competition_code, base_competition_name, base_competition_external_id, fixture_import_enabled, result_sync_enabled, created_at, archived_at",
        )
        .order("created_at", { ascending: false }),
      adminSupabase
        .from("league_memberships")
        .select("league_id, user_id, role, status")
        .eq("status", "active"),
      selectedTab === "overview"
        ? adminSupabase
            .from("bug_reports")
            .select("id", { count: "exact", head: true })
            .eq("status", "open")
        : Promise.resolve({ data: null, count: 0, error: null }),
    ]);
    const profileRows = platformProfiles ?? [];
    const leagueRows =
      (platformLeagues as PlatformLeagueDatabaseRow[] | null) ?? [];
    const seasonRows =
      (platformSeasons as (PlatformSeasonDatabaseRow & AdminSeasonRow)[] | null) ?? [];
    const membershipRows =
      (platformMemberships as PlatformMembershipDatabaseRow[] | null) ?? [];
    platformLeagueRows = leagueRows;
    platformSeasonRows = seasonRows;
    platformMembershipRows = membershipRows;
    const seasonIds = seasonRows.map((season) => season.id);
    const { data: platformGameweeks } =
      seasonIds.length && ["overview", "seasons"].includes(selectedTab)
      ? await adminSupabase
          .from("gameweeks")
          .select("id, season_id, gameweek_number, name, fixtures(id, status)")
          .in("season_id", seasonIds)
      : { data: [] };
    const gameweekRows =
      (platformGameweeks as PlatformGameweekDatabaseRow[] | null) ?? [];
    const activeSeasons = seasonRows.filter(
      (season) => season.status === "active",
    );
    const activeSeasonIds = new Set(activeSeasons.map((season) => season.id));
    const activeSeasonByLeague = new Map(
      activeSeasons.flatMap((season) =>
        season.league_id ? [[season.league_id, season] as const] : [],
      ),
    );
    const activeMemberCountByLeague = new Map<string, number>();
    const leagueAdminCountByLeague = new Map<string, number>();
    const gameweekCountBySeason = new Map<string, number>();
    const seasonCountByLeague = new Map<string, number>();
    const archivedSeasonCountByLeague = new Map<string, number>();
    const latestCompletedGameweekBySeason = new Map<
      string,
      PlatformGameweekDatabaseRow
    >();

    for (const membershipRow of membershipRows) {
      activeMemberCountByLeague.set(
        membershipRow.league_id,
        (activeMemberCountByLeague.get(membershipRow.league_id) ?? 0) + 1,
      );

      if (membershipRow.role === "league_admin") {
        leagueAdminCountByLeague.set(
          membershipRow.league_id,
          (leagueAdminCountByLeague.get(membershipRow.league_id) ?? 0) + 1,
        );
      }
    }

    for (const gameweekRow of gameweekRows) {
      gameweekCountBySeason.set(
        gameweekRow.season_id,
        (gameweekCountBySeason.get(gameweekRow.season_id) ?? 0) + 1,
      );

      const fixtures = gameweekRow.fixtures ?? [];
      const isComplete =
        fixtures.length > 0 &&
        fixtures.every((fixture) =>
          ["completed", "postponed", "void"].includes(fixture.status),
        );
      const currentLatest = latestCompletedGameweekBySeason.get(
        gameweekRow.season_id,
      );

      if (
        isComplete &&
        (!currentLatest ||
          gameweekRow.gameweek_number > currentLatest.gameweek_number)
      ) {
        latestCompletedGameweekBySeason.set(
          gameweekRow.season_id,
          gameweekRow,
        );
      }
    }

    for (const season of seasonRows) {
      if (!season.league_id) {
        continue;
      }

      seasonCountByLeague.set(
        season.league_id,
        (seasonCountByLeague.get(season.league_id) ?? 0) + 1,
      );

      if (season.status === "archived") {
        archivedSeasonCountByLeague.set(
          season.league_id,
          (archivedSeasonCountByLeague.get(season.league_id) ?? 0) + 1,
        );
      }
    }

    const leagueNameById = new Map(
      leagueRows.map((league) => [league.id, league.name]),
    );
    platformLeagueOverview = leagueRows.map((league) => {
      const leagueActiveSeason = activeSeasonByLeague.get(league.id);

      return {
        id: league.id,
        name: league.name,
        competition:
          leagueActiveSeason?.base_competition_name ??
          leagueActiveSeason?.base_competition_code ??
          league.default_base_competition_name,
        activeSeason: leagueActiveSeason?.name ?? null,
        activeMembers: activeMemberCountByLeague.get(league.id) ?? 0,
        leagueAdmins: leagueAdminCountByLeague.get(league.id) ?? 0,
        seasonCount: seasonCountByLeague.get(league.id) ?? 0,
        archivedSeasonCount:
          archivedSeasonCountByLeague.get(league.id) ?? 0,
        status: league.status,
      };
    });
    platformSeasonOverview = seasonRows.map((season) => {
      const latestCompletedGameweek = latestCompletedGameweekBySeason.get(
        season.id,
      );

      return {
        id: season.id,
        leagueId: season.league_id,
        leagueName: season.league_id
          ? (leagueNameById.get(season.league_id) ?? "Unknown league")
          : "Unassigned",
        name: season.name,
        competition:
          season.base_competition_name ?? season.base_competition_code,
        status: season.status,
        gameweekCount: gameweekCountBySeason.get(season.id) ?? 0,
        activeMembers: season.league_id
          ? (activeMemberCountByLeague.get(season.league_id) ?? 0)
          : 0,
        latestCompletedGameweek: latestCompletedGameweek
          ? latestCompletedGameweek.name ||
            `Gameweek ${latestCompletedGameweek.gameweek_number}`
          : null,
        resultSyncEnabled: Boolean(season.result_sync_enabled),
        fixtureImportEnabled: Boolean(season.fixture_import_enabled),
      };
    });
    platformOverviewCounts = {
      approvedUsers: profileRows.filter((item) => item.status === "approved")
        .length,
      pendingUsers: profileRows.filter((item) => item.status === "pending")
        .length,
      disabledUsers: profileRows.filter((item) => item.status === "disabled")
        .length,
      activeLeagues: leagueRows.filter((item) => item.status === "active")
        .length,
      activeSeasons: activeSeasons.length,
      leaguesWithoutActiveSeason: leagueRows.filter(
        (league) =>
          league.status === "active" && !activeSeasonByLeague.has(league.id),
      ).length,
      upcomingUnpickedGameweeks: gameweekRows.filter(
        (gameweek) =>
          activeSeasonIds.has(gameweek.season_id) &&
          (gameweek.fixtures?.length ?? 0) === 0,
      ).length,
      openBugReports: bugReportResult.error
        ? null
        : (bugReportResult.count ?? 0),
    };
  }

  const requestedLeagueId =
    params.league && params.league !== "all" ? params.league : null;
  const defaultMaintenanceLeagueId = shellSelectedLeague?.id ?? null;
  const scopedLeagueId =
    requestedLeagueId ??
    (selectedTab === "maintenance" && params.league !== "all"
      ? defaultMaintenanceLeagueId
      : null);
  const selectedLeague =
    platformLeagueRows.find((league) => league.id === scopedLeagueId) ?? null;
  const activeSeason =
    platformSeasonRows.find(
      (season) =>
        season.league_id === selectedLeague?.id && season.status === "active",
    ) ?? null;
  const seasonList = selectedLeague
    ? platformSeasonRows.filter(
        (season) => season.league_id === selectedLeague.id,
      )
    : [];
  const visiblePlatformSeasons =
    selectedTab === "seasons" && selectedLeague
      ? platformSeasonOverview.filter(
          (season) => season.leagueId === selectedLeague.id,
        )
      : platformSeasonOverview;

  const { data: externalCompetitionRows } = ["seasons", "maintenance"].includes(
    selectedTab,
  )
    ? await adminSupabase
        .from("external_competitions")
        .select(
          "provider, external_competition_code, external_competition_id, name",
        )
        .eq("provider", "football_data")
        .eq("enabled", true)
        .order("display_order", { ascending: true })
    : { data: [] };
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
  const scopedMemberUserIds = selectedLeague
    ? platformMembershipRows
        .filter((membership) => membership.league_id === selectedLeague.id)
        .map((membership) => membership.user_id)
    : [];

  const { data: gameweeks } = activeSeason
    ? await adminSupabase
        .from("gameweeks")
        .select("id, gameweek_number, name, is_double_gameweek")
        .eq("season_id", activeSeason.id)
        .order("gameweek_number", { ascending: true })
    : { data: null };

  const gameweekList = (gameweeks ?? []) as Gameweek[];

  const gameweekIds = gameweekList.map((gameweek) => gameweek.id);

  const { data: fixtureRows } =
    gameweekIds.length > 0
      ? await adminSupabase
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

  const { data: profiles } =
    selectedTab === "maintenance" && scopedMemberUserIds.length > 0
      ? await adminSupabase
          .from("profiles")
          .select("id, display_name, email, role, status")
          .in("id", scopedMemberUserIds)
          .eq("status", "approved")
          .order("display_name", { ascending: true })
      : { data: [] };

  const { data: adminUsers, error: adminUsersError } =
    selectedTab === "users"
      ? await adminSupabase
          .from("profiles")
          .select("id, email, display_name, role, status")
          .order("status", { ascending: false })
          .order("display_name", { ascending: true })
      : { data: [], error: null };

  const { data: fixtures, error } =
    selectedTab === "maintenance" && selectedGameweek
    ? await adminSupabase
        .from("fixtures")
        .select(
          "id, gameweek_id, home_team, away_team, kickoff_at, competition, status, home_score, away_score",
        )
        .eq("gameweek_id", selectedGameweek.id)
        .order("kickoff_at", { ascending: true })
    : { data: null, error: null };

  const fixtureList = (fixtures as Fixture[] | null) ?? [];
  const userList = (adminUsers as AdminUser[] | null) ?? [];
  const userSearch = String(params.user_search ?? "").trim().toLowerCase();
  const userStatus = ["pending", "approved", "disabled", "rejected"].includes(
    String(params.user_status),
  )
    ? String(params.user_status)
    : "all";
  const userRole = ["admin", "player"].includes(String(params.user_role))
    ? String(params.user_role)
    : "all";
  const userLeagueId = platformLeagueRows.some(
    (league) => league.id === params.user_league,
  )
    ? String(params.user_league)
    : "all";
  const leagueFilteredUserIds =
    userLeagueId === "all"
      ? null
      : new Set(
          platformMembershipRows
            .filter((membership) => membership.league_id === userLeagueId)
            .map((membership) => membership.user_id),
        );
  const filteredUserList = userList.filter((adminUser) => {
    const matchesSearch =
      !userSearch ||
      adminUser.display_name.toLowerCase().includes(userSearch) ||
      adminUser.email?.toLowerCase().includes(userSearch);
    const matchesStatus =
      userStatus === "all" || adminUser.status === userStatus;
    const matchesRole = userRole === "all" || adminUser.role === userRole;
    const matchesLeague =
      !leagueFilteredUserIds || leagueFilteredUserIds.has(adminUser.id);

    return matchesSearch && matchesStatus && matchesRole && matchesLeague;
  });
  const pendingUsers = filteredUserList.filter(
    (adminUser) => adminUser.status === "pending",
  );
  const approvedUsers = filteredUserList.filter(
    (adminUser) => adminUser.status === "approved",
  );
  const rejectedUsers = filteredUserList.filter(
    (adminUser) => adminUser.status === "rejected",
  );
  const disabledUsers = filteredUserList.filter(
    (adminUser) => adminUser.status === "disabled",
  );

  const { data: gameweekPickerAssignments } =
    selectedTab === "maintenance" && activeSeason?.id
    ? await adminSupabase
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
            kickoff_at,
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

  const needsHealthData = ["overview", "maintenance"].includes(selectedTab);
  const { count: approvedUserCount } = needsHealthData
    ? await adminSupabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("status", "approved")
    : { count: 0 };

  const { count: predictionCount } =
    needsHealthData && activeSeasonFixtureIds.length > 0
      ? await adminSupabase
          .from("predictions")
          .select("id", { count: "exact", head: true })
          .in("fixture_id", activeSeasonFixtureIds)
      : { count: 0 };

  const completedFixtureIds = activeSeasonFixtures
    .filter((fixture) => fixture.status === "completed")
    .map((fixture) => fixture.id);

  const { data: completedFixturePredictions } =
    needsHealthData && completedFixtureIds.length > 0
      ? await adminSupabase
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

  const { count: leaderboardEntryCount } = needsHealthData && activeSeason?.id
    ? await adminSupabase
        .from("leaderboard_entries")
        .select("id", { count: "exact", head: true })
        .eq("season_id", activeSeason.id)
    : { count: 0 };

  const { count: reminderCount, error: reminderCountError } = needsHealthData
    ? await adminSupabase
        .from("email_notifications")
        .select("id", { count: "exact", head: true })
    : { count: 0, error: null };

  const { data: latestReminder, error: latestReminderError } = needsHealthData
    ? await adminSupabase
        .from("email_notifications")
        .select("email_type, sent_at")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };

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
  const adminAllowOtherCompetitions = canBrowseOtherCompetitions(
    activeSeasonExternalConfig?.base_competition_code,
  );
  const adminCompetitionOptions = adminAllowOtherCompetitions
    ? seasonSettingsCompetitionOptions
    : seasonSettingsCompetitionOptions.filter(
        (competition) =>
          competition.external_competition_code ===
          activeSeasonExternalConfig?.base_competition_code,
      );
  const selectedAdminCompetition =
    adminCompetitionOptions.find(
      (competition) =>
        competition.external_competition_code === params.competition,
    ) ??
    adminCompetitionOptions.find(
      (competition) =>
        competition.external_competition_code ===
        activeSeasonExternalConfig?.base_competition_code,
    ) ??
    adminCompetitionOptions[0] ??
    null;
  const selectedAdminCompetitionCode =
    selectedAdminCompetition?.external_competition_code ??
    activeSeasonExternalConfig?.base_competition_code ??
    null;
  const nowIso = new Date().toISOString();
  const { data: adminExternalFixtureRows } =
    selectedTab === "maintenance" &&
    adminExternalFixturesConfigured &&
    selectedAdminCompetitionCode
      ? await adminSupabase
          .from("external_fixtures")
          .select(
            "id, provider, external_fixture_id, external_competition_code, external_round, external_matchday, external_stage, external_group, home_team, away_team, kickoff_at, status",
          )
          .eq("provider", "football_data")
          .eq("external_competition_code", selectedAdminCompetitionCode)
          .in("status", ["TIMED", "SCHEDULED"])
          .gt("kickoff_at", nowIso)
          .order("kickoff_at", { ascending: true })
          .limit(200)
      : { data: [] };
  const { data: adminBaseExternalFixtureRows } =
    selectedTab === "maintenance" &&
    adminExternalFixturesConfigured &&
    activeSeasonExternalConfig?.base_competition_code
      ? await adminSupabase
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
          .limit(200)
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
  const adminBaseGroupTimings = buildFixtureGroupTimings(adminBaseRows);
  const adminCurrentBaseGroupKey = adminBaseFirstGroupKey;
  const adminIsBaseCompetition =
    selectedAdminCompetitionCode ===
    activeSeasonExternalConfig?.base_competition_code;
  const adminSpecialFixtureCutoff =
    adminAllowOtherCompetitions && !adminIsBaseCompetition
      ? getSpecialFixtureCutoff({
          baseGroups: adminBaseGroupTimings,
          currentGroupKey: adminCurrentBaseGroupKey,
        })
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
        : adminAllowOtherCompetitions &&
            !adminIsBaseCompetition &&
            !isKickoffBeforeSpecialFixtureCutoff({
              kickoffAt: fixture.kickoff_at,
              cutoff: adminSpecialFixtureCutoff,
            })
          ? `Too close to the next ${
              activeSeasonExternalConfig?.base_competition_name ??
              activeSeasonExternalConfig?.base_competition_code ??
              "base league"
            } gameweek`
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

  const maintenanceSeasonOptions = (
    selectedLeague ? seasonList : platformSeasonRows
  ).map((season) => ({
    id: season.id,
    name: season.name,
    status: season.status,
  })) as MaintenanceSeasonOption[];

  logServerTiming("admin.page", pageStartedAt, {
    userId: user?.id,
    tab: selectedTab,
    leagueId: selectedLeague?.id,
  });

  return (
    <>
      <header className="brand-card p-5 sm:p-6">
        <p className="brand-eyebrow">Global control room</p>
        <h1 className="brand-title mt-2">Platform Admin</h1>
        <p className="brand-subtitle mt-2">
          Global users and league health, plus selected-league season, fixture,
          result, provider, and maintenance tools. League admins manage only
          their own league from League Settings.
        </p>
      </header>

      <AdminTabs
        selectedTab={selectedTab}
        selectedGameweekId={selectedGameweek?.id ?? null}
      />

      {params.saved ? (
        <ToastTrigger
          title={getAdminSavedToastTitle(params.tab, params.saved)}
          triggerKey={`admin:${params.tab ?? selectedTab}:${params.saved}`}
        />
      ) : null}

      {params.error ? (
        <p className="brand-alert-danger mt-4">
          {params.error}
        </p>
      ) : null}

      {selectedTab === "overview" ? (
        <PlatformAdminOverview
          view="overview"
          counts={platformOverviewCounts}
          leagues={platformLeagueOverview}
          seasons={platformSeasonOverview}
          archiveSeasonAction={archiveSeason}
        />
      ) : null}

      {selectedTab === "leagues" ? (
        <PlatformAdminOverview
          view="leagues"
          counts={platformOverviewCounts}
          leagues={platformLeagueOverview}
          seasons={platformSeasonOverview}
          archiveSeasonAction={archiveSeason}
        />
      ) : null}

      {selectedTab === "seasons" ? (
        <>
          <AdminScopeSelector
            tab="seasons"
            leagues={platformLeagueRows}
            selectedLeagueId={selectedLeague?.id ?? null}
            selectedLeagueName={selectedLeague?.name ?? null}
            activeSeasonName={activeSeason?.name ?? null}
            allowAll
          />
          <PlatformAdminOverview
            view="seasons"
            counts={platformOverviewCounts}
            leagues={platformLeagueOverview}
            seasons={visiblePlatformSeasons}
            archiveSeasonAction={archiveSeason}
            archiveReturnTo="season"
          />

          {selectedLeague ? (
            <>
              <AdminSeasonControlsCard
                leagueId={selectedLeague.id}
                seasons={seasonList}
                createSeasonAction={createSeason}
                rolloverSeasonAction={rolloverActiveSeason}
                activateSeasonAction={activateSeason}
                archiveSeasonAction={archiveSeason}
                restoreSeasonAction={restoreSeasonToDraft}
                updateArchiveVisibilityAction={updateSeasonArchiveVisibility}
                deleteSeasonAction={deleteSeason}
                activeGameweekCount={gameweekList.length}
              />

              <AdminSeasonSettingsCard
                activeSeason={
                  (activeSeason as AdminSeasonSettingsSeason | null) ?? null
                }
                competitionOptions={seasonSettingsCompetitionOptions}
                action={updateActiveSeasonProviderSettings}
              />
            </>
          ) : (
            <p className="brand-alert-warning mt-6">
              Select a specific league to create, activate, roll over, or
              configure its seasons. The table above remains global.
            </p>
          )}
        </>
      ) : null}

      {selectedTab === "maintenance" ? (
        <AdminScopeSelector
          tab="maintenance"
          leagues={platformLeagueRows}
          selectedLeagueId={selectedLeague?.id ?? null}
          selectedLeagueName={selectedLeague?.name ?? null}
          activeSeasonName={activeSeason?.name ?? null}
          allowAll
        />
      ) : null}

      {selectedTab === "maintenance" && selectedLeague ? (
        <section className="brand-card mt-6 p-4 sm:p-5">
          <div className="brand-section-header">
            <p className="brand-eyebrow">Selected season operations</p>
            <h2 className="text-2xl font-black tracking-tight">
              Fixtures, gameweeks, and results
            </h2>
            <p className="brand-subtitle">
              League: {selectedLeague.name} · Active season:{" "}
              {activeSeason?.name ?? "This league is between seasons"}
            </p>
          </div>
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
            basePath={`/admin?tab=maintenance&league=${selectedLeague.id}`}
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
              competitionOptions={adminCompetitionOptions}
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
            Review platform account requests and manage global app roles. League
            membership roles are managed separately.
          </p>

          <form
            action="/admin"
            method="get"
            className="brand-card-soft mt-5 grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_180px_180px_220px_auto] xl:items-end"
          >
            <input type="hidden" name="tab" value="users" />
            <label className="text-sm font-semibold text-slate-300">
              Search name or email
              <input
                type="search"
                name="user_search"
                defaultValue={params.user_search ?? ""}
                placeholder="Start typing a name or email"
                className="brand-input mt-1"
              />
            </label>
            <label className="text-sm font-semibold text-slate-300">
              Status
              <select
                name="user_status"
                defaultValue={userStatus}
                className="brand-input mt-1"
              >
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="disabled">Disabled</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-300">
              Platform role
              <select
                name="user_role"
                defaultValue={userRole}
                className="brand-input mt-1"
              >
                <option value="all">All roles</option>
                <option value="admin">Platform admins</option>
                <option value="player">Normal users</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-300">
              League membership
              <select
                name="user_league"
                defaultValue={userLeagueId}
                className="brand-input mt-1"
              >
                <option value="all">All leagues</option>
                {platformLeagueRows.map((league) => (
                  <option key={league.id} value={league.id}>
                    {league.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 md:col-span-2 xl:col-span-1">
              <button type="submit" className="brand-button-primary flex-1">
                Filter users
              </button>
              <Link
                href="/admin?tab=users"
                className="brand-button-secondary"
              >
                Clear
              </Link>
            </div>
          </form>

          <p className="mt-3 text-sm text-slate-400">
            Showing {filteredUserList.length} of {userList.length} platform
            accounts. League filtering checks active league memberships; it
            does not change global approval scope.
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

          {!adminUsersError &&
          userList.length > 0 &&
          filteredUserList.length === 0 ? (
            <p className="brand-card-soft mt-4 p-4 text-sm text-slate-400">
              No users match these filters.
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
          selectedLeagueName={selectedLeague?.name ?? null}
          activeSeasonId={activeSeason?.id ?? null}
          activeSeasonName={activeSeason?.name ?? null}
          activeSeasonBaseCompetitionCode={
            activeSeasonExternalConfig?.base_competition_code ?? null
          }
          seasons={maintenanceSeasonOptions}
          healthChecks={healthChecks}
          reminderReadiness={reminderReadiness}
          externalFixtureReadiness={externalFixtureReadiness}
          externalResultSyncSummary={externalResultSyncSummary}
          recalculateAction={recalculateActiveSeasonLeaderboard}
          rescoreAction={rescoreActiveSeasonAndRecalculateLeaderboard}
          testNotificationAction={createMaintenanceTestNotification}
        />
      ) : null}
    </>
  );
}
