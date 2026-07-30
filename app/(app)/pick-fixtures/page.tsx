export const dynamic = "force-dynamic";

import GameweekSelector from "@/components/gameweeks/GameweekSelector";
import CompetitionBrowseSelect from "@/components/pick-fixtures/CompetitionBrowseSelect";
import EditFixturesLink from "@/components/pick-fixtures/EditFixturesLink";
import SubmitButton from "@/components/forms/SubmitButton";
import ToastTrigger from "@/components/toast/ToastTrigger";
import TeamIdentity from "@/components/predictions/TeamIdentity";
import type { Fixture, Gameweek } from "@/components/predictions/types";
import { createClient } from "@/utils/supabase/server";
import { getActiveSeason } from "@/utils/seasons";
import {
  getEditablePickerGameweeks,
  type PickerEligibleGameweek,
} from "@/utils/picker-eligibility";
import {
  getExpectedExternalPickCount,
  getExternalFixtureGroupKey,
} from "@/utils/external-fixtures";
import {
  buildFixtureGroupTimings,
  buildFixtureTimingWindow,
  buildLeagueFixtureTimingWindow,
  formatTimingWindow,
  isKickoffOutsideTimingWindow,
} from "@/utils/fixture-timing-window";
import { canBrowseOtherCompetitions } from "@/utils/football-competitions";
import { getFixtureContextLabel } from "@/utils/fixture-context";
import {
  buildTeamStandingLookup,
  getMeaningfulStandingRows,
  getStandingForTeam,
  type TeamStandingDisplayRow,
  type TeamStandingSummary,
} from "@/utils/team-standings-display";
import { getProviderTeamIdentityFromRawPayload } from "@/utils/team-assets";
import { saveExternalPickerFixtures, savePickerFixtures } from "./actions";
import { redirect } from "next/navigation";

type PickerGameweek = PickerEligibleGameweek & Gameweek;

type ActiveSeasonPickerConfig = {
  id: string;
  base_provider: string | null;
  base_competition_code: string | null;
  base_competition_name: string | null;
  provider_season: string | null;
};

type ExternalCompetitionOption = {
  provider: string;
  external_competition_code: string;
  name: string;
  enabled: boolean;
  display_order: number;
};

type PickerFixture = Fixture & {
  external_provider: string | null;
  external_fixture_id: string | null;
  external_competition_code: string | null;
  external_round: string | null;
  external_matchday: number | null;
  external_status: string | null;
  external_last_synced_at: string | null;
};

type ExternalFixtureCacheRow = {
  id: string;
  provider: string;
  external_fixture_id: string;
  external_competition_code: string;
  external_round: string | null;
  external_matchday: number | null;
  external_stage: string | null;
  external_group: string | null;
  provider_season: string | null;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  status: string;
  last_synced_at: string | null;
  raw_payload?: unknown;
  home_team_code?: string | null;
  away_team_code?: string | null;
  home_crest_url?: string | null;
  away_crest_url?: string | null;
  home_position_label?: string | null;
  away_position_label?: string | null;
  home_standing?: TeamStandingSummary | null;
  away_standing?: TeamStandingSummary | null;
};

type CompletedExternalFixtureForForm = {
  external_fixture_id: string;
  external_competition_code: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  home_score: number;
  away_score: number;
};

type CompactFormResult = {
  fixtureId: string;
  opponent: string;
  kickoffAt: string;
  score: string;
  result: "W" | "D" | "L";
  venue: "H" | "A";
};

type UsedExternalFixtureRow = {
  external_provider: string | null;
  external_fixture_id: string | null;
  gameweek_id: string;
};

const slotNumbers = [1, 2, 3, 4];
const selectableExternalStatuses = ["TIMED", "SCHEDULED"];

function formatDateTimeLocal(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatKickoff(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatKickoffDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatLastImported(value: string | null) {
  return value
    ? formatKickoff(value)
    : "Unknown";
}

function getExternalGroupLabel(fixture: ExternalFixtureCacheRow) {
  if (fixture.external_matchday !== null) {
    return `Matchday ${fixture.external_matchday}`;
  }

  if (fixture.external_stage) {
    return fixture.external_stage;
  }

  return formatKickoffDate(fixture.kickoff_at);
}

function getCompactForm({
  teamName,
  fixtureKickoffAt,
  competitionCode,
  completedFixtures,
}: {
  teamName: string;
  fixtureKickoffAt: string;
  competitionCode: string;
  completedFixtures: CompletedExternalFixtureForForm[];
}): CompactFormResult[] {
  return completedFixtures
    .filter(
      (fixture) =>
        fixture.external_competition_code === competitionCode &&
        fixture.kickoff_at < fixtureKickoffAt &&
        (fixture.home_team === teamName || fixture.away_team === teamName),
    )
    .sort(
      (a, b) =>
        new Date(b.kickoff_at).getTime() - new Date(a.kickoff_at).getTime(),
    )
    .slice(0, 6)
    .map((fixture) => {
      const isHome = fixture.home_team === teamName;
      const goalsFor = isHome ? fixture.home_score : fixture.away_score;
      const goalsAgainst = isHome ? fixture.away_score : fixture.home_score;

      return {
        fixtureId: fixture.external_fixture_id,
        opponent: isHome ? fixture.away_team : fixture.home_team,
        kickoffAt: fixture.kickoff_at,
        score: `${goalsFor}-${goalsAgainst}`,
        venue: isHome ? "H" : "A",
        result:
          goalsFor > goalsAgainst ? "W" : goalsFor === goalsAgainst ? "D" : "L",
      };
    });
}

function CompactFormChips({
  results,
  standing,
  standingsUnavailableReason,
}: {
  results: CompactFormResult[];
  standing?: TeamStandingSummary | null;
  standingsUnavailableReason?: string | null;
}) {
  if (results.length === 0) {
    return (
      <div className="space-y-1.5">
        {standing ? (
          <StandingMiniSummary standing={standing} />
        ) : standingsUnavailableReason ? (
          <p className="text-xs text-slate-500">{standingsUnavailableReason}</p>
        ) : null}
        <p className="text-xs text-slate-500">No recent form yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {standing ? (
        <StandingMiniSummary standing={standing} />
      ) : standingsUnavailableReason ? (
        <p className="text-xs text-slate-500">{standingsUnavailableReason}</p>
      ) : null}

      <div className="space-y-1">
        {results.slice(0, 4).map((result) => (
          <div
            key={result.fixtureId}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-1.5 text-xs"
          >
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${
                result.result === "W"
                  ? "bg-emerald-300/15 text-emerald-200"
                  : result.result === "D"
                    ? "bg-amber-300/15 text-amber-200"
                    : "bg-red-300/15 text-red-200"
              }`}
            >
              {result.result}
            </span>
            <span className="min-w-0 truncate text-slate-400">
              {result.venue} v {result.opponent}
            </span>
            <span className="font-semibold tabular-nums text-slate-300">
              {result.score}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StandingMiniSummary({ standing }: { standing: TeamStandingSummary }) {
  return (
    <p className="text-xs text-slate-400">
      <span className="font-black text-amber-200">{standing.positionLabel}</span>{" "}
      · P{standing.played ?? 0} · {standing.points ?? 0} pts
    </p>
  );
}

function MiniStandingComparison({
  homeTeam,
  awayTeam,
  homeStanding,
  awayStanding,
  standingsUnavailableReason,
}: {
  homeTeam: string;
  awayTeam: string;
  homeStanding?: TeamStandingSummary | null;
  awayStanding?: TeamStandingSummary | null;
  standingsUnavailableReason?: string | null;
}) {
  const rows = [
    { teamName: homeTeam, standing: homeStanding },
    { teamName: awayTeam, standing: awayStanding },
  ];
  const hasStandings = rows.every((row) => row.standing);
  const showGoalDifference = rows.some(
    (row) =>
      row.standing?.goalDifference !== null &&
      row.standing?.goalDifference !== undefined,
  );

  if (!hasStandings) {
    return standingsUnavailableReason ? (
      <p className="rounded-lg border border-white/10 bg-slate-950/60 p-2 text-xs text-slate-500">
        {standingsUnavailableReason}
      </p>
    ) : null;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-white/10 bg-slate-950/60">
      <div
        className={`grid min-w-[28rem] ${
          showGoalDifference
            ? "grid-cols-[3rem_minmax(7rem,1fr)_2rem_2rem_2rem_2rem_2rem_2.5rem]"
            : "grid-cols-[3rem_minmax(7rem,1fr)_2rem_2rem_2rem_2rem_2.5rem]"
        } gap-1 border-b border-white/10 px-2 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500`}
      >
        <span>Pos</span>
        <span>Team</span>
        <span className="text-center">P</span>
        <span className="text-center">W</span>
        <span className="text-center">D</span>
        <span className="text-center">L</span>
        {showGoalDifference ? <span className="text-center">GD</span> : null}
        <span className="text-right">Pts</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.teamName}
          className={`grid min-w-[28rem] ${
            showGoalDifference
              ? "grid-cols-[3rem_minmax(7rem,1fr)_2rem_2rem_2rem_2rem_2rem_2.5rem]"
              : "grid-cols-[3rem_minmax(7rem,1fr)_2rem_2rem_2rem_2rem_2.5rem]"
          } items-center gap-1 border-b border-white/5 px-2 py-1.5 text-xs last:border-b-0`}
        >
          <span className="font-black text-amber-200">
            {row.standing?.positionLabel}
          </span>
          <span className="min-w-0 truncate font-semibold text-slate-200">
            {row.teamName}
          </span>
          <span className="text-center tabular-nums text-slate-300">
            {row.standing?.played ?? 0}
          </span>
          <span className="text-center tabular-nums text-slate-300">
            {row.standing?.won ?? 0}
          </span>
          <span className="text-center tabular-nums text-slate-300">
            {row.standing?.drawn ?? 0}
          </span>
          <span className="text-center tabular-nums text-slate-300">
            {row.standing?.lost ?? 0}
          </span>
          {showGoalDifference ? (
            <span className="text-center tabular-nums text-slate-300">
              {row.standing?.goalDifference ?? "-"}
            </span>
          ) : null}
          <span className="text-right font-black tabular-nums text-white">
            {row.standing?.points ?? 0}
          </span>
        </div>
      ))}
    </div>
  );
}

function groupExternalFixtures(fixtures: ExternalFixtureCacheRow[]) {
  const groups = new Map<
    string,
    { label: string; fixtures: ExternalFixtureCacheRow[] }
  >();

  for (const fixture of fixtures) {
    const key = getExternalFixtureGroupKey(fixture);
    const existingGroup = groups.get(key);

    groups.set(key, {
      label: existingGroup?.label ?? getExternalGroupLabel(fixture),
      fixtures: [...(existingGroup?.fixtures ?? []), fixture],
    });
  }

  return [...groups.entries()].map(([key, group]) => ({
    key,
    label: group.label,
    fixtures: group.fixtures.sort(
      (a, b) =>
        new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime(),
    ),
  }));
}

export default async function PickFixturesPage({
  searchParams,
}: {
  searchParams?: Promise<{
    saved?: string;
    error?: string;
    edit?: string;
    gameweek?: string;
    competition?: string;
  }>;
}) {
  const params = searchParams ? await searchParams : {};
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: activeSeason } = await getActiveSeason(
    supabase,
    "id, base_provider, base_competition_code, base_competition_name, provider_season",
  );
  const activeSeasonConfig = activeSeason as ActiveSeasonPickerConfig | null;

  const eligibleGameweeks = activeSeason
    ? ((await getEditablePickerGameweeks({
        supabase,
        userId: user.id,
        activeSeasonId: activeSeasonConfig!.id,
      })) as PickerGameweek[])
    : [];

  if (!activeSeason) {
    return (
      <>
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Pick Fixtures</h1>
          <p className="mt-2 text-sm text-slate-400">
            Fixture picking will open once an admin activates a season.
          </p>
        </header>

        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-300">
            No active season
          </p>
          <p className="mt-2 text-sm text-slate-300">
            There is no live season for fixture selection yet.
          </p>
        </section>
      </>
    );
  }

  if (eligibleGameweeks.length === 0) {
    return (
      <>
        <header className="brand-card mb-8 p-5 sm:p-6">
          <p className="brand-eyebrow">Fixture picker</p>
          <h1 className="brand-title mt-2">Pick Fixtures</h1>
          <p className="brand-subtitle mt-2">
            You are not currently assigned to pick fixtures for an unlocked
            active-season gameweek.
          </p>
        </header>

        <section className="brand-card p-4 sm:p-5">
          <p className="text-sm font-semibold text-slate-300">
            Nothing to pick right now
          </p>
          <p className="mt-2 text-sm text-slate-400">
            Your assigned gameweek may still be locked until the previous
            gameweek is complete, predictions may already exist, or you may not
            be scheduled as a picker.
          </p>
        </section>
      </>
    );
  }

  const selectedGameweek =
    eligibleGameweeks.find((gameweek) => gameweek.id === params.gameweek) ??
    eligibleGameweeks[0];

  const { data: fixtures, error: fixturesError } = selectedGameweek
    ? await supabase
        .from("fixtures")
        .select(
          "id, gameweek_id, home_team, away_team, kickoff_at, competition, status, home_score, away_score, external_provider, external_fixture_id, external_competition_code, external_round, external_matchday, external_status, external_last_synced_at, external_raw_payload",
        )
        .eq("gameweek_id", selectedGameweek.id)
        .order("kickoff_at", { ascending: true })
    : { data: null, error: null };

  const fixtureList = (fixtures as PickerFixture[] | null) ?? [];
  const fixtureIds = fixtureList.map((fixture) => fixture.id);

  const { data: existingPrediction } =
    fixtureIds.length > 0
      ? await supabase
          .from("predictions")
          .select("fixture_id")
          .in("fixture_id", fixtureIds)
          .limit(1)
          .maybeSingle()
      : { data: null };

  const isLockedByPredictions = Boolean(existingPrediction);
  const pickerFixtures = fixtureList.slice(0, 4);
  const extraFixtureCount = Math.max(0, fixtureList.length - 4);
  const completedFixtureSlots = pickerFixtures.length;
  const currentExternalFixtureIds = new Set(
    fixtureList
      .map((fixture) => fixture.external_fixture_id)
      .filter((value): value is string => Boolean(value)),
  );

  const externalFixturesConfigured =
    activeSeasonConfig?.base_provider === "football_data" &&
    Boolean(activeSeasonConfig.base_competition_code);

  const { data: competitionRows } = externalFixturesConfigured
    ? await supabase
        .from("external_competitions")
        .select("provider, external_competition_code, name, enabled, display_order")
        .eq("provider", "football_data")
        .eq("enabled", true)
        .order("display_order", { ascending: true })
    : { data: null };
  const externalCompetitionOptions =
    (competitionRows as ExternalCompetitionOption[] | null) ?? [];
  const allowOtherCompetitions = canBrowseOtherCompetitions(
    activeSeasonConfig?.base_competition_code,
  );
  const competitionOptions =
    allowOtherCompetitions && externalCompetitionOptions.length > 0
      ? externalCompetitionOptions
      : activeSeasonConfig?.base_competition_code
        ? [
            {
              provider: "football_data",
              external_competition_code: activeSeasonConfig.base_competition_code,
              name:
                activeSeasonConfig.base_competition_name ??
                activeSeasonConfig.base_competition_code,
              enabled: true,
              display_order: 0,
            },
          ]
        : [];
  const requestedCompetitionCode = params.competition ?? null;
  const selectedCompetition =
    competitionOptions.find(
      (competition) =>
        competition.external_competition_code === requestedCompetitionCode,
    ) ??
    competitionOptions.find(
      (competition) =>
        competition.external_competition_code ===
        activeSeasonConfig?.base_competition_code,
    ) ??
    competitionOptions[0] ??
    null;
  const selectedCompetitionCode =
    selectedCompetition?.external_competition_code ??
    activeSeasonConfig?.base_competition_code ??
    null;
  const isBaseCompetition =
    selectedCompetitionCode === activeSeasonConfig?.base_competition_code;

  const { data: seasonGameweeks } = activeSeasonConfig?.id
    ? await supabase
        .from("gameweeks")
        .select("id")
        .eq("season_id", activeSeasonConfig.id)
    : { data: null };

  const seasonGameweekIds =
    (seasonGameweeks as { id: string }[] | null)?.map((gameweek) => gameweek.id) ??
    [];

  const { data: usedExternalFixtures } =
    seasonGameweekIds.length > 0
      ? await supabase
          .from("fixtures")
          .select("external_provider, external_fixture_id, gameweek_id")
          .in("gameweek_id", seasonGameweekIds)
          .not("external_provider", "is", null)
          .not("external_fixture_id", "is", null)
      : { data: [] };

  const usedExternalFixtureList =
    (usedExternalFixtures as UsedExternalFixtureRow[] | null) ?? [];
  const externalFixtureUsedInAnotherGameweek = new Set(
    usedExternalFixtureList
      .filter((fixture) => fixture.gameweek_id !== selectedGameweek.id)
      .map((fixture) => `${fixture.external_provider}:${fixture.external_fixture_id}`),
  );

  const nowIso = new Date().toISOString();
  const { data: externalFixtures, error: externalFixturesError } =
    externalFixturesConfigured && selectedCompetitionCode
      ? await supabase
          .from("external_fixtures")
          .select(
            "id, provider, external_fixture_id, external_competition_code, external_round, external_matchday, external_stage, external_group, provider_season, home_team, away_team, kickoff_at, status, last_synced_at, raw_payload",
          )
          .eq("provider", activeSeasonConfig!.base_provider!)
          .eq("external_competition_code", selectedCompetitionCode)
          .in("status", selectableExternalStatuses)
          .gt("kickoff_at", nowIso)
          .order("kickoff_at", { ascending: true })
      : { data: null, error: null };

  const { data: baseCompetitionFixtureRows } =
    externalFixturesConfigured && activeSeasonConfig?.base_competition_code
      ? await supabase
          .from("external_fixtures")
          .select(
            "id, provider, external_fixture_id, external_competition_code, external_round, external_matchday, external_stage, external_group, provider_season, home_team, away_team, kickoff_at, status, last_synced_at, raw_payload",
          )
          .eq("provider", activeSeasonConfig.base_provider!)
          .eq("external_competition_code", activeSeasonConfig.base_competition_code)
          .in("status", selectableExternalStatuses)
          .gt("kickoff_at", nowIso)
          .order("kickoff_at", { ascending: true })
      : { data: [] };

  const allExternalFixtureRows =
    (externalFixtures as ExternalFixtureCacheRow[] | null) ?? [];
  const baseExternalFixtureRows =
    (baseCompetitionFixtureRows as ExternalFixtureCacheRow[] | null) ?? [];
  const standingCompetitionCodes = [
    ...new Set(
      [selectedCompetitionCode, activeSeasonConfig?.base_competition_code].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ];
  let standingRows: unknown[] | null = [];

  if (standingCompetitionCodes.length > 0) {
    let standingQuery = supabase
      .from("external_team_standings")
      .select(
        "external_competition_code, provider_season, team_name, team_short_name, team_tla, crest_url, position, played, won, drawn, lost, points, raw_payload",
      )
      .eq("provider", "football_data")
      .in("external_competition_code", standingCompetitionCodes);

    if (activeSeasonConfig?.provider_season) {
      standingQuery = standingQuery.eq(
        "provider_season",
        activeSeasonConfig.provider_season,
      );
    }

    const { data } = await standingQuery;
    standingRows = data;
  }

  const { meaningfulRows: meaningfulStandingRows, hiddenPreseasonGroups } =
    getMeaningfulStandingRows(
      (standingRows as TeamStandingDisplayRow[] | null) ?? [],
    );
  const standingsByCompetitionAndTeam =
    buildTeamStandingLookup(meaningfulStandingRows);
  const addStandingPositions = (fixture: ExternalFixtureCacheRow) => {
    const homeIdentity = getProviderTeamIdentityFromRawPayload(
      fixture.raw_payload,
      "home",
    );
    const awayIdentity = getProviderTeamIdentityFromRawPayload(
      fixture.raw_payload,
      "away",
    );
    const homeStanding = getStandingForTeam({
      lookup: standingsByCompetitionAndTeam,
      competitionCode: fixture.external_competition_code,
      teamName:
        homeIdentity.displayName ??
        homeIdentity.shortName ??
        fixture.home_team,
    });
    const awayStanding = getStandingForTeam({
      lookup: standingsByCompetitionAndTeam,
      competitionCode: fixture.external_competition_code,
      teamName:
        awayIdentity.displayName ??
        awayIdentity.shortName ??
        fixture.away_team,
    });

    return {
      ...fixture,
      home_team_code: homeIdentity.teamCode,
      away_team_code: awayIdentity.teamCode,
      home_crest_url: homeIdentity.crestUrl ?? homeStanding?.crestUrl ?? null,
      away_crest_url: awayIdentity.crestUrl ?? awayStanding?.crestUrl ?? null,
      home_position_label: homeStanding?.positionLabel ?? null,
      away_position_label: awayStanding?.positionLabel ?? null,
      home_standing: homeStanding,
      away_standing: awayStanding,
    };
  };
  const allExternalFixtureRowsWithPositions =
    allExternalFixtureRows.map(addStandingPositions);
  const baseExternalFixtureRowsWithPositions =
    baseExternalFixtureRows.map(addStandingPositions);
  let completedExternalFormRows: unknown[] | null = [];

  if (standingCompetitionCodes.length > 0) {
    let completedExternalFormQuery = supabase
      .from("external_fixtures")
      .select(
        "external_fixture_id, external_competition_code, home_team, away_team, kickoff_at, home_score, away_score",
      )
      .eq("provider", "football_data")
      .in("external_competition_code", standingCompetitionCodes)
      .eq("status", "FINISHED")
      .not("home_score", "is", null)
      .not("away_score", "is", null)
      .order("kickoff_at", { ascending: false })
      .limit(500);

    if (activeSeasonConfig?.provider_season) {
      completedExternalFormQuery = completedExternalFormQuery.eq(
        "provider_season",
        activeSeasonConfig.provider_season,
      );
    }

    const { data } = await completedExternalFormQuery;
    completedExternalFormRows = data;
  }
  const completedExternalFormFixtures =
    (completedExternalFormRows as CompletedExternalFixtureForForm[] | null) ?? [];
  const baseExternalGroups = groupExternalFixtures(
    baseExternalFixtureRowsWithPositions,
  );
  const baseTimingGroup =
    baseExternalGroups.find((group) =>
      group.fixtures.some((fixture) =>
        currentExternalFixtureIds.has(fixture.external_fixture_id),
      ),
    ) ??
    baseExternalGroups[0] ??
    null;
  const baseGroupTimings = buildFixtureGroupTimings(
    baseExternalFixtureRowsWithPositions,
  );
  const currentBaseGroupKey = baseTimingGroup
    ? getExternalFixtureGroupKey(baseTimingGroup.fixtures[0])
    : null;
  const currentBaseGroupIndex = currentBaseGroupKey
    ? baseGroupTimings.findIndex((group) => group.key === currentBaseGroupKey)
    : 0;
  const currentBaseTimingGroup =
    baseGroupTimings[currentBaseGroupIndex >= 0 ? currentBaseGroupIndex : 0] ??
    null;
  const nextBaseTimingGroup =
    currentBaseGroupIndex >= 0
      ? baseGroupTimings[currentBaseGroupIndex + 1] ?? null
      : baseGroupTimings[1] ?? null;
  const leagueTimingWindow =
    allowOtherCompetitions
      ? buildLeagueFixtureTimingWindow({
          currentBaseGroup: currentBaseTimingGroup,
          nextBaseGroup: nextBaseTimingGroup,
        }) ??
        buildFixtureTimingWindow({
          selectedFixtureKickoffs: [],
          baseCompetitionKickoffs:
            baseTimingGroup?.fixtures.map((fixture) => fixture.kickoff_at) ?? [],
        })
      : null;
  const crossCompetitionFilteredExternalFixtureRows =
    allowOtherCompetitions && !isBaseCompetition
      ? allExternalFixtureRowsWithPositions.filter(
          (fixture) =>
            !isKickoffOutsideTimingWindow({
            kickoffAt: fixture.kickoff_at,
              timingWindow: leagueTimingWindow,
          }),
        )
      : allExternalFixtureRowsWithPositions;
  const selectableExternalFixtureRows =
    crossCompetitionFilteredExternalFixtureRows.filter(
      (fixture) =>
        !externalFixtureUsedInAnotherGameweek.has(
          `${fixture.provider}:${fixture.external_fixture_id}`,
        ) || currentExternalFixtureIds.has(fixture.external_fixture_id),
    );
  const externalFixtureGroups = groupExternalFixtures(
    selectableExternalFixtureRows,
  );
  const selectedExternalGroup =
    externalFixtureGroups.find((group) =>
      group.fixtures.some((fixture) =>
        currentExternalFixtureIds.has(fixture.external_fixture_id),
      ),
    ) ??
    externalFixtureGroups[0] ??
    null;
  const timingWindow = leagueTimingWindow;
  const timingWindowText = timingWindow ? formatTimingWindow(timingWindow) : null;
  const expectedExternalPickCount = selectedExternalGroup
    ? getExpectedExternalPickCount(selectedExternalGroup.fixtures.length)
    : 0;
  const currentSelectedExternalCount = selectedExternalGroup
    ? selectedExternalGroup.fixtures.filter((fixture) =>
        currentExternalFixtureIds.has(fixture.external_fixture_id),
      ).length
    : 0;
  const externalModeAvailable = Boolean(
    externalFixturesConfigured && selectedExternalGroup,
  );
  const activeExpectedFixtureCount = externalModeAvailable
    ? expectedExternalPickCount
    : 4;
  const activeSelectedFixtureCount = externalModeAvailable
    ? currentSelectedExternalCount
    : completedFixtureSlots;
  const activePickerIsComplete =
    activeExpectedFixtureCount > 0 &&
    activeSelectedFixtureCount === activeExpectedFixtureCount;
  const availableFixtureSummaryCount =
    allowOtherCompetitions && !isBaseCompetition
      ? selectableExternalFixtureRows.length
      : (selectedExternalGroup?.fixtures.length ?? selectableExternalFixtureRows.length);
  const isEditingFixtureSelection = params.edit === "1" || !activePickerIsComplete;
  const showFixtureEditor = isEditingFixtureSelection && !isLockedByPredictions;
  const gameweekHelperText =
    activePickerIsComplete && !isEditingFixtureSelection
      ? "Fixtures are picked. You can edit them until predictions start."
      : externalModeAvailable && expectedExternalPickCount > 0
      ? `Select the ${expectedExternalPickCount} fixture${
          expectedExternalPickCount === 1 ? "" : "s"
        } for this matchday, then save once.`
      : "Fill in up to four fixtures, then save once.";
  const latestExternalImport =
    allExternalFixtureRows
      .map((fixture) => fixture.last_synced_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

  const inputClassName =
    "brand-input";

  return (
    <>
      <header className="brand-card mb-8 p-5 sm:p-6">
        <p className="brand-eyebrow">Fixture picker</p>
        <h1 className="brand-title mt-2">Pick Fixtures</h1>
        <p className="brand-subtitle mt-2">
          Choose fixtures for your assigned gameweek.
        </p>
      </header>

      {params.saved ? (
        <ToastTrigger title="Fixtures picked" triggerKey={`pick:${params.saved}`} />
      ) : null}

      {params.error ? (
        <p className="brand-alert-danger mb-4">
          {params.error}
        </p>
      ) : null}

      <section className="brand-card p-4 sm:p-5">
        <GameweekSelector
          gameweeks={eligibleGameweeks}
          selectedGameweekId={selectedGameweek?.id ?? null}
          basePath="/pick-fixtures"
        />

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-tight">
              {selectedGameweek?.name ||
                `Gameweek ${selectedGameweek.gameweek_number}`}
            </h2>
            <p className="text-sm text-slate-400">
              {gameweekHelperText}
            </p>
          </div>

          <span
            className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-bold ${
              activePickerIsComplete
                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                : "border-amber-300/25 bg-amber-300/10 text-amber-300"
            }`}
          >
            {activeSelectedFixtureCount}/{activeExpectedFixtureCount} fixtures
            selected
          </span>
        </div>

        {fixturesError ? (
          <p className="brand-alert-danger">
            Could not load fixtures for this gameweek. Please try again shortly.
          </p>
        ) : null}

        {activePickerIsComplete ? (
          <section className="brand-card-soft mb-6 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                  Fixtures picked
                </p>
                <h3 className="mt-1 text-lg font-semibold">
                  Selected fixtures
                </h3>
                <p className="mt-1 text-sm text-slate-400">
                  {isLockedByPredictions
                    ? "Predictions have started, so fixtures can no longer be edited."
                    : "Review the saved picks or edit them before predictions start."}
                </p>
              </div>

              {!isLockedByPredictions && !isEditingFixtureSelection ? (
                <EditFixturesLink
                  href={`/pick-fixtures?gameweek=${selectedGameweek.id}&edit=1${
                    selectedCompetitionCode
                      ? `&competition=${selectedCompetitionCode}`
                      : ""
                  }`}
                />
              ) : null}
            </div>

            <div className="mt-4 grid gap-2">
              {fixtureList.map((fixture) => {
                const contextLabel = getFixtureContextLabel({
                  competitionCode: fixture.external_competition_code,
                  externalRound: fixture.external_round,
                  externalMatchday: fixture.external_matchday,
                });
                const homeIdentity = getProviderTeamIdentityFromRawPayload(
                  fixture.external_raw_payload,
                  "home",
                );
                const awayIdentity = getProviderTeamIdentityFromRawPayload(
                  fixture.external_raw_payload,
                  "away",
                );

                return (
                  <div
                    key={fixture.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                  >
                    <TeamIdentity
                      teamName={fixture.home_team}
                      teamCode={homeIdentity.teamCode}
                      crestUrl={homeIdentity.crestUrl}
                      compact
                    />
                    <span className="rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
                      v
                    </span>
                    <TeamIdentity
                      teamName={fixture.away_team}
                      teamCode={awayIdentity.teamCode}
                      crestUrl={awayIdentity.crestUrl}
                      align="right"
                      compact
                    />
                    <span className="col-span-3 text-xs text-slate-500">
                      {formatKickoff(fixture.kickoff_at)} · {fixture.competition}
                      {contextLabel ? ` · ${contextLabel}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {isLockedByPredictions ? (
          <p className="brand-alert-warning mb-4">
            Predictions have started, so fixtures can no longer be edited.
          </p>
        ) : null}

        {extraFixtureCount > 0 ? (
          <p className="brand-alert-warning mb-4">
            This gameweek has {extraFixtureCount} extra fixture
            {extraFixtureCount === 1 ? "" : "s"} created by admin. Pickers can
            only edit the first four fixtures.
          </p>
        ) : null}

        {showFixtureEditor && externalFixturesConfigured ? (
          <section className="brand-card-soft mb-6 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                  Fixture list
                </p>
                <h3 className="mt-1 text-lg font-semibold">
                  {selectedCompetition?.name ?? selectedCompetitionCode}
                </h3>
                <p className="mt-1 text-sm text-slate-400">
                  Latest available matches. Last refreshed:{" "}
                  {formatLastImported(latestExternalImport)}. If something is
                  missing, ask an admin to refresh the list.
                </p>
                {!isBaseCompetition ? (
                  <p className="mt-2 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-200">
                    Special fixture override: this is not the season base
                    competition.
                  </p>
                ) : null}
              </div>

              <span className="brand-pill w-fit">
                {currentSelectedExternalCount} of {expectedExternalPickCount}{" "}
                selected
              </span>
            </div>

            {allowOtherCompetitions && competitionOptions.length > 1 ? (
              <CompetitionBrowseSelect
                gameweekId={selectedGameweek.id}
                selectedCompetitionCode={selectedCompetitionCode ?? ""}
                options={competitionOptions}
                isEditing={isEditingFixtureSelection}
              />
            ) : null}

            {externalFixturesError ? (
              <p className="brand-alert-danger mt-4">
                Could not load the fixture list.
              </p>
            ) : null}

            {!externalFixturesError && allExternalFixtureRows.length === 0 ? (
              <p className="brand-alert-warning mt-4">
                No upcoming fixtures are available for this competition.
              </p>
            ) : null}

            {!externalFixturesError &&
            allExternalFixtureRows.length > 0 &&
            selectableExternalFixtureRows.length === 0 ? (
              <p className="brand-alert-warning mt-4">
                No fixtures available in this gameweek window.
              </p>
            ) : null}

            {selectedExternalGroup && !isLockedByPredictions ? (
              <form action={saveExternalPickerFixtures} className="mt-4">
                <input
                  type="hidden"
                  name="gameweek_id"
                  value={selectedGameweek.id}
                />
                <input
                  type="hidden"
                  name="expected_pick_count"
                  value={expectedExternalPickCount}
                />
                <input
                  type="hidden"
                  name="competition_code"
                  value={selectedCompetitionCode ?? ""}
                />

                <div className="space-y-5">
                  <div key={selectedExternalGroup.key}>
                    <p className="mb-3 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-xs font-semibold text-slate-300">
                      {availableFixtureSummaryCount} fixture
                      {availableFixtureSummaryCount === 1 ? "" : "s"} available
                      in this gameweek window
                    </p>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold text-slate-200">
                        {selectedExternalGroup.label}
                      </h4>
                      <span className="brand-pill border-emerald-400/25 bg-emerald-400/10 text-emerald-300">
                        {currentSelectedExternalCount > 0
                          ? "Selected group"
                          : "Next group"}
                      </span>
                    </div>

                    <div className="grid gap-3">
                      {selectedExternalGroup.fixtures.map((fixture) => {
                        const isAlreadySelected =
                          currentExternalFixtureIds.has(
                            fixture.external_fixture_id,
                          );

                        return (
                          <div
                            key={fixture.external_fixture_id}
                            className="rounded-xl border border-white/10 bg-slate-900/70 p-3 transition has-[:checked]:border-emerald-400/70 has-[:checked]:bg-emerald-400/10 hover:border-emerald-400/30"
                          >
                            <label className="flex cursor-pointer items-start gap-3">
                              <input
                                type="checkbox"
                                name="external_fixture_id"
                                value={fixture.external_fixture_id}
                                defaultChecked={isAlreadySelected}
                                className="mt-2 h-4 w-4 accent-emerald-500"
                              />

                              <span className="min-w-0 flex-1">
                                <span className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                                  <TeamIdentity
                                    teamName={fixture.home_team || "Unknown home team"}
                                    teamCode={fixture.home_team_code}
                                    crestUrl={fixture.home_crest_url}
                                    positionLabel={fixture.home_position_label}
                                    compact
                                  />
                                  <span className="rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
                                    v
                                  </span>
                                  <TeamIdentity
                                    teamName={fixture.away_team || "Unknown away team"}
                                    teamCode={fixture.away_team_code}
                                    crestUrl={fixture.away_crest_url}
                                    positionLabel={fixture.away_position_label}
                                    align="right"
                                    compact
                                  />
                                </span>
                                <span className="mt-2 block text-xs text-slate-400">
                                  {formatKickoff(fixture.kickoff_at)} ·{" "}
                                  {fixture.external_matchday !== null
                                    ? `Matchday ${fixture.external_matchday}`
                                    : (fixture.external_stage ??
                                      fixture.external_round ??
                                      "Round TBC")}{" "}
                                  · {fixture.status}
                                </span>
                              </span>
                            </label>

                            <details className="mt-3 border-t border-white/10 pt-2">
                              <summary className="cursor-pointer text-xs font-bold text-slate-400 hover:text-white">
                                Form guide
                              </summary>
                              <div className="mt-2 space-y-2 text-xs">
                                <MiniStandingComparison
                                  homeTeam={fixture.home_team}
                                  awayTeam={fixture.away_team}
                                  homeStanding={fixture.home_standing}
                                  awayStanding={fixture.away_standing}
                                  standingsUnavailableReason={
                                    hiddenPreseasonGroups.has(
                                      `${fixture.external_competition_code}:${
                                        activeSeasonConfig?.provider_season ?? ""
                                      }`,
                                    )
                                      ? "Table available after matches are played"
                                      : null
                                  }
                                />
                              </div>
                              <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                                <div>
                                  <p className="mb-1 font-semibold text-slate-300">
                                    {fixture.home_team}
                                  </p>
                                  <CompactFormChips
                                    results={getCompactForm({
                                      teamName: fixture.home_team,
                                      fixtureKickoffAt: fixture.kickoff_at,
                                      competitionCode:
                                        fixture.external_competition_code,
                                      completedFixtures:
                                        completedExternalFormFixtures,
                                    })}
                                  />
                                </div>
                                <div>
                                  <p className="mb-1 font-semibold text-slate-300">
                                    {fixture.away_team}
                                  </p>
                                  <CompactFormChips
                                    results={getCompactForm({
                                      teamName: fixture.away_team,
                                      fixtureKickoffAt: fixture.kickoff_at,
                                      competitionCode:
                                        fixture.external_competition_code,
                                      completedFixtures:
                                        completedExternalFormFixtures,
                                    })}
                                  />
                                </div>
                              </div>
                            </details>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <p className="mt-3 rounded-xl border border-white/10 bg-slate-900/70 p-3 text-xs text-slate-400">
                  Select {expectedExternalPickCount} fixture
                  {expectedExternalPickCount === 1 ? "" : "s"}. Saving
                  these fixtures replaces the current editable picker
                  fixtures for this gameweek.
                </p>

                <SubmitButton
                  idleLabel="Save selected fixtures"
                  pendingLabel="Saving fixtures..."
                  className="brand-button-primary mt-4 w-full"
                />
              </form>
            ) : null}

            {isLockedByPredictions ? (
              <p className="brand-card-soft mt-4 p-3 text-sm text-slate-400">
                Fixture selection is read-only because predictions have
                already been entered.
              </p>
            ) : null}
          </section>
        ) : showFixtureEditor ? (
          <section className="brand-card-soft mb-6 p-4">
            <p className="text-sm font-semibold text-slate-300">
              The match list is not set up for this season.
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Use the manual fallback below.
            </p>
          </section>
        ) : null}

        {showFixtureEditor && !externalFixturesConfigured ? (
          <details
          className={
            externalModeAvailable
              ? "brand-card-soft p-4"
              : ""
          }
          open={!externalModeAvailable}
          >
          <summary
            className={
              externalModeAvailable
                ? "cursor-pointer select-none text-sm font-semibold text-slate-300"
                : "list-none"
            }
          >
            {externalModeAvailable ? "Manual override" : null}
          </summary>

          <div className={externalModeAvailable ? "mt-4" : ""}>
            <div className="mb-3">
              <h3 className="text-lg font-semibold">
                {externalModeAvailable
                  ? "Enter fixtures manually instead"
                  : "Manual fallback"}
              </h3>
              <p className="text-sm text-slate-400">
                {externalModeAvailable
                  ? "Use this only if the match list is missing something or needs an admin-style override."
                  : "Enter fixtures manually or edit the current editable picks."}
              </p>
            </div>

            <form action={savePickerFixtures} className="space-y-4">
          <input type="hidden" name="gameweek_id" value={selectedGameweek.id} />

          {slotNumbers.map((slotNumber) => {
            const fixture = pickerFixtures[slotNumber - 1];

            return (
              <div
                key={slotNumber}
                className="brand-card-soft p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    Fixture {slotNumber}
                  </h3>

                  {fixture ? (
                    <span className="brand-pill border-emerald-400/25 bg-emerald-400/10 text-emerald-300">
                      Saved
                    </span>
                  ) : (
                    <span className="brand-pill text-slate-400">
                      Empty
                    </span>
                  )}
                </div>

                <input
                  type="hidden"
                  name={`fixture_id_${slotNumber}`}
                  value={fixture?.id ?? ""}
                />

                <div className="grid gap-3 md:grid-cols-4">
                  <div>
                    <label className="text-sm text-slate-300">Home team</label>
                    <input
                      name={`home_team_${slotNumber}`}
                      defaultValue={fixture?.home_team ?? ""}
                      disabled={isLockedByPredictions}
                      className={inputClassName}
                    />
                  </div>

                  <div>
                    <label className="text-sm text-slate-300">Away team</label>
                    <input
                      name={`away_team_${slotNumber}`}
                      defaultValue={fixture?.away_team ?? ""}
                      disabled={isLockedByPredictions}
                      className={inputClassName}
                    />
                  </div>

                  <div>
                    <label className="text-sm text-slate-300">Kickoff</label>
                    <input
                      name={`kickoff_at_${slotNumber}`}
                      type="datetime-local"
                      defaultValue={
                        fixture ? formatDateTimeLocal(fixture.kickoff_at) : ""
                      }
                      disabled={isLockedByPredictions}
                      className={inputClassName}
                    />
                  </div>

                  <div>
                    <label className="text-sm text-slate-300">
                      Competition
                    </label>
                    <input
                      name={`competition_${slotNumber}`}
                      defaultValue={
                        fixture?.competition ??
                        activeSeasonConfig?.base_competition_name ??
                        "Premier League"
                      }
                      disabled={isLockedByPredictions}
                      className={inputClassName}
                    />
                  </div>
                </div>

                {fixture && !isLockedByPredictions ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Clear all fields in this row and save to remove this
                    fixture.
                  </p>
                ) : null}
              </div>
            );
          })}

          {isLockedByPredictions ? (
            <p className="brand-card-soft p-4 text-sm text-slate-400">
              These fixtures are now read-only for the picker.
            </p>
          ) : (
            <>
              {timingWindowText ? (
                <label className="flex gap-3 rounded-xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">
                  <input
                    type="checkbox"
                    name="confirm_timing_override"
                    value="1"
                    className="mt-1 h-4 w-4 accent-amber-300"
                  />
                  <span>
                    If any manual fixture is outside the usual gameweek window (
                    {timingWindowText}), add it anyway.
                  </span>
                </label>
              ) : null}

              <SubmitButton
                idleLabel="Save fixtures"
                pendingLabel="Saving fixtures..."
                className="brand-button-primary w-full"
              />
            </>
          )}
            </form>
          </div>
          </details>
        ) : null}
      </section>
    </>
  );
}
