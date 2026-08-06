import { revalidatePath } from "next/cache";
import {
  scoreFixture,
  recalculateLeaderboard,
  upsertPostResultActivityForGameweeks,
} from "@/app/(app)/admin/actions";
import {
  fetchMatchesByIds,
  FootballDataError,
  normalizeFootballDataMatch,
} from "@/utils/football-data/client";
import { getPredictionScoringScoreFromProviderPayload } from "@/utils/provider-score";
import { createAdminClient } from "@/utils/supabase/legacy-admin";

type AdminSupabaseClient = ReturnType<typeof createAdminClient>;

type LocalExternalFixture = {
  id: string;
  gameweek_id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  external_provider: string | null;
  external_fixture_id: string | null;
  external_competition_code: string | null;
  external_last_synced_at: string | null;
};

type SeasonRow = {
  id: string;
  league_id: string;
  name: string;
  result_sync_enabled?: boolean | null;
};

type PlannedUpdate = {
  fixture_id: string;
  external_fixture_id: string;
  teams: {
    local_home: string;
    local_away: string;
    provider_home: string;
    provider_away: string;
  };
  kickoff_at: string;
  old: {
    status: string;
    home_score: number | null;
    away_score: number | null;
  };
  provider: {
    status: string;
    home_score: number | null;
    away_score: number | null;
  };
  planned: {
    status: string;
    home_score: number | null;
    away_score: number | null;
  };
  would_score: boolean;
  notes: string[];
};

type SkippedFixture = {
  fixture_id?: string;
  external_fixture_id?: string;
  reason: string;
};

export type ExternalResultSyncResult = {
  dry_run: boolean;
  season: SeasonRow;
  fixtures_checked: number;
  provider_ids: string[];
  provider_status: number;
  planned_updates: PlannedUpdate[];
  skipped: SkippedFixture[];
  api_call_count: number;
  updated_count?: number;
  scored_count?: number;
  recalculated_leaderboard?: boolean;
};

type SyncOptions = {
  supabase: AdminSupabaseClient;
  season: SeasonRow;
  dryRun: boolean;
  fixtures: LocalExternalFixture[];
  providerSnapshot?: ExternalResultProviderSnapshot;
};

export type ExternalResultProviderSnapshot = {
  matches: Map<string, Record<string, unknown>>;
  providerStatus: number;
  apiCallCount: number;
};

function mapProviderStatus({
  providerStatus,
  kickoffAt,
}: {
  providerStatus: string;
  kickoffAt: string;
}) {
  if (providerStatus === "FINISHED") {
    return "completed";
  }

  if (providerStatus === "POSTPONED") {
    return "postponed";
  }

  if (["CANCELLED", "SUSPENDED", "ABANDONED"].includes(providerStatus)) {
    return "postponed";
  }

  if (["IN_PLAY", "PAUSED", "LIVE"].includes(providerStatus)) {
    return new Date(kickoffAt) <= new Date() ? "locked" : "scheduled";
  }

  if (["TIMED", "SCHEDULED"].includes(providerStatus)) {
    return "scheduled";
  }

  return null;
}

function scoreChanged(
  fixture: LocalExternalFixture,
  planned: { home_score: number | null; away_score: number | null },
) {
  return (
    fixture.home_score !== planned.home_score ||
    fixture.away_score !== planned.away_score
  );
}

function shouldScoreFixture(
  fixture: LocalExternalFixture,
  planned: { status: string; home_score: number | null; away_score: number | null },
) {
  if (
    planned.status !== "completed" ||
    planned.home_score === null ||
    planned.away_score === null
  ) {
    return false;
  }

  return fixture.status !== "completed" || scoreChanged(fixture, planned);
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export async function fetchExternalResultProviderSnapshot(
  providerIds: string[],
): Promise<ExternalResultProviderSnapshot> {
  const matches = new Map<string, Record<string, unknown>>();
  let apiCallCount = 0;
  let providerStatus = 200;

  for (const ids of chunk([...new Set(providerIds)], 20)) {
    const result = await fetchMatchesByIds(ids);
    apiCallCount += 1;
    providerStatus = result.request.status;

    for (const match of result.matches) {
      const normalized = normalizeFootballDataMatch(match);
      matches.set(normalized.external_fixture_id, match);
    }
  }

  return { matches, providerStatus, apiCallCount };
}

export async function getSeasonById({
  supabase,
  seasonId,
}: {
  supabase: AdminSupabaseClient;
  seasonId: string;
}) {
  const { data, error } = await supabase
    .from("seasons")
    .select("id, league_id, name, result_sync_enabled, leagues!inner(status)")
    .eq("id", seasonId)
    .eq("status", "active")
    .eq("leagues.status", "active")
    .maybeSingle();

  return { season: data as SeasonRow | null, error };
}

export async function getEligibleActiveSyncSeason({
  supabase,
}: {
  supabase: AdminSupabaseClient;
}) {
  const { seasons, error } = await getEligibleActiveSyncSeasons({ supabase });

  return { season: seasons[0] ?? null, error };
}

export async function getEligibleActiveSyncSeasons({
  supabase,
}: {
  supabase: AdminSupabaseClient;
}) {
  const { data, error } = await supabase
    .from("seasons")
    .select("id, league_id, name, result_sync_enabled, leagues!inner(status)")
    .eq("status", "active")
    .eq("base_provider", "football_data")
    .eq("result_sync_enabled", true)
    .eq("leagues.status", "active")
    .order("created_at", { ascending: true });

  return { seasons: (data as SeasonRow[] | null) ?? [], error };
}

export async function getManualSyncFixtures({
  supabase,
  seasonId,
  fixtureId,
}: {
  supabase: AdminSupabaseClient;
  seasonId: string;
  fixtureId?: string | null;
}) {
  let query = supabase
    .from("fixtures")
    .select(
      `
      id,
      gameweek_id,
      home_team,
      away_team,
      kickoff_at,
      status,
      home_score,
      away_score,
      external_provider,
      external_fixture_id,
      external_competition_code,
      external_last_synced_at,
      gameweeks!inner (
        season_id
      )
    `,
    )
    .eq("gameweeks.season_id", seasonId)
    .eq("external_provider", "football_data")
    .not("external_fixture_id", "is", null)
    .neq("status", "void");

  if (fixtureId) {
    query = query.eq("id", fixtureId);
  }

  const { data, error } = await query.order("kickoff_at", { ascending: true });

  return {
    fixtures: (data as LocalExternalFixture[] | null) ?? [],
    error,
  };
}

function shouldCronSyncFixture(fixture: LocalExternalFixture, now: Date) {
  const kickoffAt = new Date(fixture.kickoff_at);
  const windowStart = new Date(kickoffAt.getTime() - 30 * 60 * 1000);
  const windowEnd = new Date(kickoffAt.getTime() + 24 * 60 * 60 * 1000);

  if (now < windowStart || now > windowEnd) {
    return false;
  }

  if (fixture.status !== "completed") {
    return true;
  }

  if (!fixture.external_last_synced_at) {
    return true;
  }

  const lastSyncedAt = new Date(fixture.external_last_synced_at);
  const nextConfirmationAt = new Date(lastSyncedAt.getTime() + 6 * 60 * 60 * 1000);

  return now >= nextConfirmationAt;
}

export async function getCronSyncFixtures({
  supabase,
  seasonId,
  now = new Date(),
}: {
  supabase: AdminSupabaseClient;
  seasonId: string;
  now?: Date;
}) {
  const earliestKickoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const latestKickoff = new Date(now.getTime() + 30 * 60 * 1000);

  const { data, error } = await supabase
    .from("fixtures")
    .select(
      `
      id,
      gameweek_id,
      home_team,
      away_team,
      kickoff_at,
      status,
      home_score,
      away_score,
      external_provider,
      external_fixture_id,
      external_competition_code,
      external_last_synced_at,
      gameweeks!inner (
        season_id
      )
    `,
    )
    .eq("gameweeks.season_id", seasonId)
    .eq("external_provider", "football_data")
    .not("external_fixture_id", "is", null)
    .in("status", ["scheduled", "locked", "completed"])
    .gte("kickoff_at", earliestKickoff.toISOString())
    .lte("kickoff_at", latestKickoff.toISOString())
    .order("kickoff_at", { ascending: true });

  const fixtures = ((data as LocalExternalFixture[] | null) ?? []).filter(
    (fixture) => shouldCronSyncFixture(fixture, now),
  );

  return { fixtures, error };
}

export async function syncExternalFixtureResults({
  supabase,
  season,
  dryRun,
  fixtures,
  providerSnapshot,
}: SyncOptions): Promise<ExternalResultSyncResult> {
  const providerIds = [
    ...new Set(
      fixtures
        .map((fixture) => fixture.external_fixture_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const plannedUpdates: PlannedUpdate[] = [];
  const skipped: SkippedFixture[] = [];
  const snapshot =
    providerSnapshot ??
    (await fetchExternalResultProviderSnapshot(providerIds));
  const providerMatches = snapshot.matches;
  const providerStatus = snapshot.providerStatus;
  const apiCallCount = providerSnapshot ? 0 : snapshot.apiCallCount;

  for (const fixture of fixtures) {
    const externalFixtureId = fixture.external_fixture_id;

    if (!externalFixtureId) {
      skipped.push({ fixture_id: fixture.id, reason: "Missing external_fixture_id" });
      continue;
    }

    const providerMatch = providerMatches.get(externalFixtureId);

    if (!providerMatch) {
      skipped.push({
        fixture_id: fixture.id,
        external_fixture_id: externalFixtureId,
        reason: "Provider response did not include this fixture",
      });
      continue;
    }

    const normalized = normalizeFootballDataMatch(
      providerMatch,
      fixture.external_competition_code ?? undefined,
    );
    const mappedStatus = mapProviderStatus({
      providerStatus: normalized.status,
      kickoffAt: fixture.kickoff_at,
    });

    if (!mappedStatus) {
      skipped.push({
        fixture_id: fixture.id,
        external_fixture_id: externalFixtureId,
        reason: `Unknown provider status ${normalized.status}`,
      });
      continue;
    }

    const notes: string[] = [];
    const providerScoringScore =
      getPredictionScoringScoreFromProviderPayload(providerMatch);
    const plannedStatus =
      mappedStatus === "scheduled" && fixture.status === "locked"
        ? "locked"
        : mappedStatus;
    let plannedHomeScore =
      mappedStatus === "completed" ? normalized.home_score : fixture.home_score;
    let plannedAwayScore =
      mappedStatus === "completed" ? normalized.away_score : fixture.away_score;

    if (providerScoringScore.source === "regularTime") {
      notes.push("Using football-data.org regularTime score for prediction scoring.");
    }

    if (providerScoringScore.warning) {
      notes.push(providerScoringScore.warning);
    }

    if (mappedStatus === "completed" && providerScoringScore.warning) {
      skipped.push({
        fixture_id: fixture.id,
        external_fixture_id: externalFixtureId,
        reason: providerScoringScore.warning,
      });
      continue;
    }

    if (
      mappedStatus === "completed" &&
      (plannedHomeScore === null || plannedAwayScore === null)
    ) {
      skipped.push({
        fixture_id: fixture.id,
        external_fixture_id: externalFixtureId,
        reason: "Provider says FINISHED but prediction scoring score is missing",
      });
      continue;
    }

    if (mappedStatus !== "completed") {
      plannedHomeScore = fixture.home_score;
      plannedAwayScore = fixture.away_score;
    }

    if (["CANCELLED", "SUSPENDED", "ABANDONED"].includes(normalized.status)) {
      notes.push("Mapped provider cancellation/suspension to postponed for admin review.");
    }

    const planned = {
      status: plannedStatus,
      home_score: plannedHomeScore,
      away_score: plannedAwayScore,
    };
    const wouldScore = shouldScoreFixture(fixture, planned);

    if (
      fixture.status === planned.status &&
      fixture.home_score === planned.home_score &&
      fixture.away_score === planned.away_score
    ) {
      notes.push("No local status/score change needed.");
    }

    plannedUpdates.push({
      fixture_id: fixture.id,
      external_fixture_id: externalFixtureId,
      teams: {
        local_home: fixture.home_team,
        local_away: fixture.away_team,
        provider_home: normalized.home_team,
        provider_away: normalized.away_team,
      },
      kickoff_at: fixture.kickoff_at,
      old: {
        status: fixture.status,
        home_score: fixture.home_score,
        away_score: fixture.away_score,
      },
      provider: {
        status: normalized.status,
        home_score: normalized.home_score,
        away_score: normalized.away_score,
      },
      planned,
      would_score: wouldScore,
      notes,
    });
  }

  let updatedCount = 0;
  let scoredCount = 0;
  let recalculatedLeaderboard = false;
  const shouldRecalculate = plannedUpdates.some((update) => update.would_score);
  const syncedAt = new Date().toISOString();
  const checkedGameweekIds = new Set(
    fixtures.map((fixture) => fixture.gameweek_id),
  );

  if (!dryRun) {
    for (const update of plannedUpdates) {
      const fixture = fixtures.find((row) => row.id === update.fixture_id);
      const providerMatch = providerMatches.get(update.external_fixture_id);

      if (!fixture || !providerMatch) {
        continue;
      }

      const normalized = normalizeFootballDataMatch(
        providerMatch,
        fixture.external_competition_code ?? undefined,
      );
      const updateTeams =
        (fixture.home_team.toUpperCase().includes("TBD") ||
          fixture.away_team.toUpperCase().includes("TBD")) &&
        normalized.home_team &&
        normalized.away_team;

      const { error: fixtureUpdateError } = await supabase
        .from("fixtures")
        .update({
          home_team: updateTeams ? normalized.home_team : fixture.home_team,
          away_team: updateTeams ? normalized.away_team : fixture.away_team,
          home_score: update.planned.home_score,
          away_score: update.planned.away_score,
          status: update.planned.status,
          external_status: normalized.status,
          external_last_synced_at: syncedAt,
          external_raw_payload: providerMatch,
        })
        .eq("id", update.fixture_id);

      if (fixtureUpdateError) {
        skipped.push({
          fixture_id: update.fixture_id,
          external_fixture_id: update.external_fixture_id,
          reason: fixtureUpdateError.message,
        });
        continue;
      }

      const { error: externalUpdateError } = await supabase
        .from("external_fixtures")
        .update({
          status: normalized.status,
          home_score: normalized.home_score,
          away_score: normalized.away_score,
          home_team: normalized.home_team,
          away_team: normalized.away_team,
          raw_payload: providerMatch,
          last_synced_at: syncedAt,
          updated_at: syncedAt,
        })
        .eq("provider", "football_data")
        .eq("external_fixture_id", update.external_fixture_id);

      if (externalUpdateError) {
        skipped.push({
          fixture_id: update.fixture_id,
          external_fixture_id: update.external_fixture_id,
          reason: externalUpdateError.message,
        });
      }

      updatedCount += 1;

      if (update.would_score) {
        await scoreFixture(update.fixture_id, supabase);
        scoredCount += 1;
      }
    }

    if (shouldRecalculate && scoredCount > 0) {
      await recalculateLeaderboard(season.id, supabase);
      recalculatedLeaderboard = true;
    }

    await upsertPostResultActivityForGameweeks({
      supabase,
      gameweekIds: checkedGameweekIds,
    });

    revalidatePath("/admin");
    revalidatePath("/dashboard");
    revalidatePath("/predictions");
    revalidatePath("/leaderboard");
  }

  return {
    dry_run: dryRun,
    season,
    fixtures_checked: fixtures.length,
    provider_ids: providerIds,
    provider_status: providerStatus,
    planned_updates: plannedUpdates,
    skipped,
    api_call_count: apiCallCount,
    updated_count: dryRun ? undefined : updatedCount,
    scored_count: dryRun ? undefined : scoredCount,
    recalculated_leaderboard: dryRun ? undefined : recalculatedLeaderboard,
  };
}

export function getFootballDataErrorResponse(error: FootballDataError) {
  return {
    error: error.message,
    provider_status: error.status,
    x_requestcounter_reset: error.resetSeconds,
  };
}

export { FootballDataError };
