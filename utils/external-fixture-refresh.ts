import {
  fetchCompetitionMatches,
  FootballDataError,
  getFootballDataSeasonQueryValue,
  normalizeFootballDataMatch,
  type NormalizedFootballDataFixture,
} from "@/utils/football-data/client";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  getCronErrorSummary,
  type CronErrorSummary,
} from "@/utils/cron-diagnostics";

type AdminSupabaseClient = ReturnType<typeof createAdminClient>;

export type ExternalFixtureRefreshSeason = {
  id: string;
  league_id: string;
  name: string;
  status: string | null;
  base_provider: string | null;
  base_competition_code: string | null;
  provider_season: string | null;
  fixture_import_enabled: boolean | null;
};

export type ExternalFixtureRefreshProviderSnapshot = {
  dateFrom: string;
  dateTo: string;
  byRequestKey: Map<
    string,
    { fixtures: NormalizedFootballDataFixture[]; request: unknown }
  >;
  errorsByRequestKey: Map<
    string,
    CronErrorSummary & { competitionCode: string; providerSeason?: string }
  >;
  providerCallCount: number;
};

type ExistingExternalFixtureRow = {
  external_fixture_id: string;
  external_competition_id: string | null;
  external_competition_code: string;
  provider_season: string | null;
  external_round: string | null;
  external_matchday: number | null;
  external_stage: string | null;
  external_group: string | null;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
};

type SelectedFixtureRow = {
  id: string;
  gameweek_id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  competition: string;
  status: string;
  external_provider: string | null;
  external_fixture_id: string | null;
  external_competition_code: string | null;
  external_round: string | null;
  external_matchday: number | null;
  external_status: string | null;
  external_last_synced_at: string | null;
};

type PredictionFixtureRow = {
  fixture_id: string;
};

export type FixtureRefreshPlannedUpdate = {
  external_fixture_id: string;
  scope: "external_cache" | "selected_fixture";
  local_fixture_id?: string;
  teams: {
    old_home: string;
    old_away: string;
    new_home: string;
    new_away: string;
  };
  kickoff: {
    old: string;
    new: string;
  };
  status: {
    old: string | null;
    new: string;
  };
  changes: string[];
  notes: string[];
};

export type FixtureRefreshSkipped = {
  external_fixture_id?: string;
  local_fixture_id?: string;
  reason: string;
};

const TERMINAL_STATUSES = new Set(["completed", "void", "postponed"]);

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getProviderRequestKey(
  competitionCode: string,
  providerSeason?: string | null,
) {
  return `${competitionCode}:${providerSeason ?? ""}`;
}

async function getSeasonCompetitionCodes({
  supabase,
  season,
}: {
  supabase: AdminSupabaseClient;
  season: ExternalFixtureRefreshSeason;
}) {
  const { data, error } = await supabase
    .from("fixtures")
    .select(
      `
        external_competition_code,
        gameweeks!inner (
          season_id
        )
      `,
    )
    .eq("gameweeks.season_id", season.id)
    .eq("external_provider", "football_data")
    .not("external_fixture_id", "is", null)
    .not("external_competition_code", "is", null);

  if (error) {
    throw new Error(error.message);
  }

  return [
    ...new Set([
      season.base_competition_code,
      ...(((data as { external_competition_code: string | null }[] | null) ?? [])
        .map((row) => row.external_competition_code)
        .filter((code): code is string => Boolean(code))),
    ]),
  ].filter((code): code is string => Boolean(code));
}

export async function fetchExternalFixtureRefreshProviderSnapshot({
  supabase,
  seasons,
  now = new Date(),
}: {
  supabase: AdminSupabaseClient;
  seasons: ExternalFixtureRefreshSeason[];
  now?: Date;
}): Promise<ExternalFixtureRefreshProviderSnapshot> {
  const dateFrom = formatDateOnly(addDays(now, -2));
  const dateTo = formatDateOnly(addDays(now, 60));
  const requests = new Map<
    string,
    { competitionCode: string; providerSeason?: string }
  >();

  for (const season of seasons) {
    const competitionCodes = await getSeasonCompetitionCodes({ supabase, season });

    for (const competitionCode of competitionCodes) {
      const providerSeason =
        competitionCode === season.base_competition_code
          ? getFootballDataSeasonQueryValue(season.provider_season)
          : undefined;
      requests.set(getProviderRequestKey(competitionCode, providerSeason), {
        competitionCode,
        providerSeason,
      });
    }
  }

  const byRequestKey: ExternalFixtureRefreshProviderSnapshot["byRequestKey"] =
    new Map();
  const errorsByRequestKey: ExternalFixtureRefreshProviderSnapshot["errorsByRequestKey"] =
    new Map();
  let providerCallCount = 0;
  let rateLimitError: CronErrorSummary | null = null;

  for (const [requestKey, providerRequest] of requests) {
    if (rateLimitError) {
      errorsByRequestKey.set(requestKey, {
        competitionCode: providerRequest.competitionCode,
        providerSeason: providerRequest.providerSeason,
        ...rateLimitError,
        error: "Provider rate limited; config was not attempted.",
      });
      continue;
    }

    providerCallCount += 1;

    try {
      const { matches, request } = await fetchCompetitionMatches({
        competitionCode: providerRequest.competitionCode,
        dateFrom,
        dateTo,
        season: providerRequest.providerSeason,
      });
      byRequestKey.set(requestKey, {
        request,
        fixtures: matches.map((match) =>
          normalizeFootballDataMatch(match, providerRequest.competitionCode),
        ),
      });
    } catch (error) {
      const errorSummary = getCronErrorSummary(error);
      errorsByRequestKey.set(requestKey, {
        competitionCode: providerRequest.competitionCode,
        providerSeason: providerRequest.providerSeason,
        ...errorSummary,
      });

      if (errorSummary.providerStatus === 429) {
        rateLimitError = errorSummary;
      }
    }
  }

  return {
    dateFrom,
    dateTo,
    byRequestKey,
    errorsByRequestKey,
    providerCallCount,
  };
}

function isUsefulText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlaceholderTeamName(value: string) {
  const normalized = value.trim().toLowerCase();

  return (
    normalized === "tbd" ||
    normalized === "tbc" ||
    normalized.includes("winner of") ||
    normalized.includes("loser of") ||
    normalized.includes("to be decided") ||
    normalized.includes("unknown")
  );
}

function preserveNullable<T>(incoming: T | null, existing: T | null | undefined) {
  return incoming ?? existing ?? null;
}

function toExternalUpsertRow({
  fixture,
  existing,
  syncedAt,
}: {
  fixture: NormalizedFootballDataFixture;
  existing: ExistingExternalFixtureRow | undefined;
  syncedAt: string;
}) {
  return {
    provider: fixture.provider,
    external_fixture_id: fixture.external_fixture_id,
    external_competition_id: preserveNullable(
      fixture.external_competition_id,
      existing?.external_competition_id,
    ),
    external_competition_code:
      fixture.external_competition_code || existing?.external_competition_code,
    provider_season: preserveNullable(fixture.provider_season, existing?.provider_season),
    external_round: preserveNullable(fixture.external_round, existing?.external_round),
    external_matchday:
      fixture.external_matchday ?? existing?.external_matchday ?? null,
    external_stage: preserveNullable(fixture.external_stage, existing?.external_stage),
    external_group: preserveNullable(fixture.external_group, existing?.external_group),
    home_team: isUsefulText(fixture.home_team)
      ? fixture.home_team
      : (existing?.home_team ?? fixture.home_team),
    away_team: isUsefulText(fixture.away_team)
      ? fixture.away_team
      : (existing?.away_team ?? fixture.away_team),
    kickoff_at: fixture.kickoff_at || existing?.kickoff_at,
    status: fixture.status || existing?.status,
    home_score: fixture.home_score ?? existing?.home_score ?? null,
    away_score: fixture.away_score ?? existing?.away_score ?? null,
    raw_payload: fixture.raw_payload,
    last_synced_at: syncedAt,
    updated_at: syncedAt,
  };
}

function getExternalChanges({
  fixture,
  existing,
}: {
  fixture: NormalizedFootballDataFixture;
  existing: ExistingExternalFixtureRow | undefined;
}) {
  const changes: string[] = [];

  if (!existing) {
    return ["new cache row"];
  }

  if (existing.home_team !== fixture.home_team || existing.away_team !== fixture.away_team) {
    changes.push("teams");
  }

  if (existing.kickoff_at !== fixture.kickoff_at) {
    changes.push("kickoff_at");
  }

  if (existing.status !== fixture.status) {
    changes.push("status");
  }

  if (
    existing.external_round !== fixture.external_round ||
    existing.external_stage !== fixture.external_stage ||
    existing.external_group !== fixture.external_group ||
    (fixture.external_matchday !== null &&
      existing.external_matchday !== fixture.external_matchday)
  ) {
    changes.push("metadata");
  }

  return changes;
}

function shouldUpdateTeamName({
  currentName,
  providerName,
  hasPredictions,
}: {
  currentName: string;
  providerName: string;
  hasPredictions: boolean;
}) {
  if (currentName === providerName) {
    return false;
  }

  return !hasPredictions || isPlaceholderTeamName(currentName);
}

export async function getEligibleActiveRefreshSeason({
  supabase,
  seasonId,
}: {
  supabase: AdminSupabaseClient;
  seasonId: string;
}) {
  const { data, error } = await supabase
    .from("seasons")
    .select(
      "id, league_id, name, status, base_provider, base_competition_code, provider_season, fixture_import_enabled, leagues!inner(status)",
    )
    .eq("id", seasonId)
    .eq("status", "active")
    .eq("base_provider", "football_data")
    .eq("fixture_import_enabled", true)
    .eq("leagues.status", "active")
    .maybeSingle();

  return {
    season: (data as ExternalFixtureRefreshSeason | null) ?? null,
    error,
  };
}

export async function getEligibleActiveRefreshSeasons({
  supabase,
}: {
  supabase: AdminSupabaseClient;
}) {
  const { data, error } = await supabase
    .from("seasons")
    .select(
      "id, league_id, name, status, base_provider, base_competition_code, provider_season, fixture_import_enabled, leagues!inner(status)",
    )
    .eq("status", "active")
    .eq("base_provider", "football_data")
    .eq("fixture_import_enabled", true)
    .eq("leagues.status", "active")
    .order("created_at", { ascending: true });

  return {
    seasons: ((data as ExternalFixtureRefreshSeason[] | null) ?? []).filter(
      (season) => Boolean(season.base_competition_code),
    ),
    error,
  };
}

export async function refreshExternalFixtures({
  supabase,
  season,
  dryRun,
  now = new Date(),
  providerSnapshot,
}: {
  supabase: AdminSupabaseClient;
  season: ExternalFixtureRefreshSeason;
  dryRun: boolean;
  now?: Date;
  providerSnapshot?: ExternalFixtureRefreshProviderSnapshot;
}) {
  if (season.base_provider !== "football_data" || !season.base_competition_code) {
    return {
      dry_run: dryRun,
      skipped_run: true,
      reason: "active season has no football-data provider/competition configured",
      season,
      provider_calls_made: 0,
      external_fixtures_checked: 0,
      external_fixtures_updated: 0,
      selected_app_fixtures_checked: 0,
      selected_app_fixtures_updated: 0,
      kickoff_changes: 0,
      team_name_changes: 0,
      planned_updates: [] as FixtureRefreshPlannedUpdate[],
      skipped: [] as FixtureRefreshSkipped[],
    };
  }

  const syncedAt = now.toISOString();
  const dateFrom = providerSnapshot?.dateFrom ?? formatDateOnly(addDays(now, -2));
  const dateTo = providerSnapshot?.dateTo ?? formatDateOnly(addDays(now, 60));
  const competitionCodes = await getSeasonCompetitionCodes({ supabase, season });

  const providerRequests: unknown[] = [];
  const fixtures: NormalizedFootballDataFixture[] = [];

  for (const competitionCode of competitionCodes) {
    const providerSeason =
      competitionCode === season.base_competition_code
        ? getFootballDataSeasonQueryValue(season.provider_season)
        : undefined;
    const snapshotResult = providerSnapshot?.byRequestKey.get(
      getProviderRequestKey(competitionCode, providerSeason),
    );
    const snapshotError = providerSnapshot?.errorsByRequestKey.get(
      getProviderRequestKey(competitionCode, providerSeason),
    );

    if (snapshotError) {
      throw new FootballDataError(
        snapshotError.error,
        snapshotError.providerStatus ?? 502,
        snapshotError.retryAfterSeconds ?? null,
      );
    }
    const fetched = snapshotResult
      ? null
      : await fetchCompetitionMatches({
          competitionCode,
          dateFrom,
          dateTo,
          season: providerSeason,
        });
    const request = snapshotResult?.request ?? fetched!.request;
    const normalizedFixtures =
      snapshotResult?.fixtures ??
      fetched!.matches.map((match) =>
        normalizeFootballDataMatch(match, competitionCode),
      );

    providerRequests.push(request);
    fixtures.push(...normalizedFixtures);
  }
  const uniqueFixtures = [...new Map(
    fixtures.map((fixture) => [fixture.external_fixture_id, fixture]),
  ).values()];
  const externalFixtureIds = uniqueFixtures
    .map((fixture) => fixture.external_fixture_id)
    .filter(Boolean);
  const { data: existingExternalFixtures, error: existingExternalError } =
    externalFixtureIds.length > 0
      ? await supabase
          .from("external_fixtures")
          .select(
            "external_fixture_id, external_competition_id, external_competition_code, provider_season, external_round, external_matchday, external_stage, external_group, home_team, away_team, kickoff_at, status, home_score, away_score",
          )
          .eq("provider", "football_data")
          .in("external_fixture_id", externalFixtureIds)
      : { data: [], error: null };

  if (existingExternalError) {
    throw new Error(existingExternalError.message);
  }

  const existingExternalById = new Map(
    ((existingExternalFixtures as ExistingExternalFixtureRow[] | null) ?? []).map(
      (fixture) => [fixture.external_fixture_id, fixture],
    ),
  );
  const providerById = new Map(
    uniqueFixtures.map((fixture) => [fixture.external_fixture_id, fixture]),
  );
  const plannedUpdates: FixtureRefreshPlannedUpdate[] = [];
  const skipped: FixtureRefreshSkipped[] = [];
  const externalRows = uniqueFixtures.map((fixture) => {
    const existing = existingExternalById.get(fixture.external_fixture_id);
    const changes = getExternalChanges({ fixture, existing });

    if (changes.length > 0) {
      plannedUpdates.push({
        external_fixture_id: fixture.external_fixture_id,
        scope: "external_cache",
        teams: {
          old_home: existing?.home_team ?? "",
          old_away: existing?.away_team ?? "",
          new_home: fixture.home_team,
          new_away: fixture.away_team,
        },
        kickoff: {
          old: existing?.kickoff_at ?? "",
          new: fixture.kickoff_at,
        },
        status: {
          old: existing?.status ?? null,
          new: fixture.status,
        },
        changes,
        notes:
          fixture.external_matchday === null && existing?.external_matchday !== null
            ? ["preserved existing external_matchday"]
            : [],
      });
    }

    return toExternalUpsertRow({
      fixture,
      existing,
      syncedAt,
    });
  });

  const { data: selectedFixtures, error: selectedFixturesError } =
    externalFixtureIds.length > 0
      ? await supabase
          .from("fixtures")
          .select(
            `
            id,
            gameweek_id,
            home_team,
            away_team,
            kickoff_at,
            competition,
            status,
            external_provider,
            external_fixture_id,
            external_competition_code,
            external_round,
            external_matchday,
            external_status,
            external_last_synced_at,
            gameweeks!inner (
              season_id
            )
          `,
          )
          .eq("gameweeks.season_id", season.id)
          .eq("external_provider", "football_data")
          .in("external_fixture_id", externalFixtureIds)
      : { data: [], error: null };

  if (selectedFixturesError) {
    throw new Error(selectedFixturesError.message);
  }

  const selectedRows = (selectedFixtures as SelectedFixtureRow[] | null) ?? [];
  const selectedIds = selectedRows.map((fixture) => fixture.id);
  const { data: predictionRows, error: predictionError } =
    selectedIds.length > 0
      ? await supabase
          .from("predictions")
          .select("fixture_id")
          .in("fixture_id", selectedIds)
      : { data: [], error: null };

  if (predictionError) {
    throw new Error(predictionError.message);
  }

  const fixturesWithPredictions = new Set(
    ((predictionRows as PredictionFixtureRow[] | null) ?? []).map(
      (prediction) => prediction.fixture_id,
    ),
  );
  const selectedUpdates: { id: string; update: Record<string, unknown> }[] = [];
  let kickoffChanges = 0;
  let teamNameChanges = 0;

  for (const selected of selectedRows) {
    if (!selected.external_fixture_id) {
      continue;
    }

    const providerFixture = providerById.get(selected.external_fixture_id);

    if (!providerFixture) {
      skipped.push({
        local_fixture_id: selected.id,
        external_fixture_id: selected.external_fixture_id,
        reason: "provider response did not include selected fixture",
      });
      continue;
    }

    if (TERMINAL_STATUSES.has(selected.status)) {
      skipped.push({
        local_fixture_id: selected.id,
        external_fixture_id: selected.external_fixture_id,
        reason: "selected fixture is terminal",
      });
      continue;
    }

    const hasPredictions = fixturesWithPredictions.has(selected.id);
    const update: Record<string, unknown> = {
      external_status: providerFixture.status,
      external_last_synced_at: syncedAt,
      external_raw_payload: providerFixture.raw_payload,
    };
    const changes: string[] = [];
    const notes: string[] = [];

    if (
      (selected.status === "scheduled" || selected.status === "locked") &&
      selected.kickoff_at !== providerFixture.kickoff_at
    ) {
      update.kickoff_at = providerFixture.kickoff_at;
      changes.push("kickoff_at");
      kickoffChanges += 1;
    }

    if (
      shouldUpdateTeamName({
        currentName: selected.home_team,
        providerName: providerFixture.home_team,
        hasPredictions,
      })
    ) {
      update.home_team = providerFixture.home_team;
      changes.push("home_team");
      teamNameChanges += 1;
    } else if (selected.home_team !== providerFixture.home_team && hasPredictions) {
      notes.push("home team change skipped because predictions exist");
    }

    if (
      shouldUpdateTeamName({
        currentName: selected.away_team,
        providerName: providerFixture.away_team,
        hasPredictions,
      })
    ) {
      update.away_team = providerFixture.away_team;
      changes.push("away_team");
      teamNameChanges += 1;
    } else if (selected.away_team !== providerFixture.away_team && hasPredictions) {
      notes.push("away team change skipped because predictions exist");
    }

    if (providerFixture.external_round && selected.external_round !== providerFixture.external_round) {
      update.external_round = providerFixture.external_round;
      changes.push("external_round");
    }

    if (
      providerFixture.external_matchday !== null &&
      selected.external_matchday !== providerFixture.external_matchday
    ) {
      update.external_matchday = providerFixture.external_matchday;
      changes.push("external_matchday");
    }

    if (changes.length > 0 || notes.length > 0) {
      plannedUpdates.push({
        external_fixture_id: selected.external_fixture_id,
        local_fixture_id: selected.id,
        scope: "selected_fixture",
        teams: {
          old_home: selected.home_team,
          old_away: selected.away_team,
          new_home: String(update.home_team ?? selected.home_team),
          new_away: String(update.away_team ?? selected.away_team),
        },
        kickoff: {
          old: selected.kickoff_at,
          new: String(update.kickoff_at ?? selected.kickoff_at),
        },
        status: {
          old: selected.external_status,
          new: providerFixture.status,
        },
        changes,
        notes,
      });
    }

    if (Object.keys(update).length > 0) {
      selectedUpdates.push({ id: selected.id, update });
    }
  }

  if (!dryRun) {
    if (externalRows.length > 0) {
      const { error: upsertError } = await supabase
        .from("external_fixtures")
        .upsert(externalRows, { onConflict: "provider,external_fixture_id" });

      if (upsertError) {
        throw new Error(upsertError.message);
      }
    }

    for (const selectedUpdate of selectedUpdates) {
      const { error } = await supabase
        .from("fixtures")
        .update(selectedUpdate.update)
        .eq("id", selectedUpdate.id);

      if (error) {
        throw new Error(error.message);
      }
    }
  }

  return {
    dry_run: dryRun,
    skipped_run: false,
    season,
    window: { date_from: dateFrom, date_to: dateTo },
    provider_request: providerRequests[0] ?? null,
    provider_requests: providerRequests,
    provider_calls_made: providerSnapshot ? 0 : providerRequests.length,
    provider_requests_reused: providerSnapshot ? providerRequests.length : 0,
    external_fixtures_checked: uniqueFixtures.length,
    external_fixtures_updated: plannedUpdates.filter(
      (update) => update.scope === "external_cache",
    ).length,
    selected_app_fixtures_checked: selectedRows.length,
    selected_app_fixtures_updated: selectedUpdates.length,
    kickoff_changes: kickoffChanges,
    team_name_changes: teamNameChanges,
    planned_updates: plannedUpdates,
    skipped,
    last_synced_at: syncedAt,
  };
}

export { FootballDataError };
