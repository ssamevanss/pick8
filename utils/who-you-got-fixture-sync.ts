import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";
import type { Tables, TablesInsert } from "@/types/database.types";
import { logicalPick8FixtureKey } from "@/utils/pick8-fixture-identity";
import { earliestFixtureKickoff } from "@/utils/pick8-fixture-state";
import { shouldSyncProviderFixtures } from "@/utils/pick8-fixture-sync-mode";
import {
  getProviderPayloadMatchday,
  representSameKickoff,
} from "@/utils/pick8-matchday-generation";

const REQUEST_TIMEOUT_MS = 10_000;
const FIXTURE_STATUSES = new Set([
  "scheduled",
  "timed",
  "in_play",
  "paused",
  "finished",
  "postponed",
  "cancelled",
]);

type FixtureStatus =
  | "scheduled"
  | "timed"
  | "in_play"
  | "paused"
  | "finished"
  | "postponed"
  | "cancelled";

type SourceFixture = {
  externalFixtureId: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamCrestUrl: string | null;
  awayTeamCrestUrl: string | null;
  kickoffAt: string;
  status: FixtureStatus;
  homeScore: number | null;
  awayScore: number | null;
  sourceMatchday: number | null;
};

export type FixtureSyncSummary = {
  season: number;
  matchday: number;
  matchdayStatus: string;
  received: number;
  inserted: number;
  updated: number;
  unchanged: number;
  removed: number;
  invalidatedEntries: number;
  potentialRemovals: string[];
  syncedAt: string;
};

export class FixtureSyncError extends Error {
  constructor(
    public readonly code:
      | "validation"
      | "manual_matchday"
      | "configuration"
      | "authentication"
      | "missing_mapping"
      | "upstream"
      | "invalid_response"
      | "database",
    message: string,
  ) {
    super(message);
    this.name = "FixtureSyncError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function first(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }
  return null;
}

function stringValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function integerValue(value: unknown, nullable = false) {
  if (value === null || value === undefined) return nullable ? null : undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function crestUrlValue(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.startsWith("https://") ? trimmed : undefined;
}

function teamDetails(
  fixture: Record<string, unknown>,
  side: "home" | "away",
) {
  const snake = record(fixture[`${side}_team`]);
  const camel = record(fixture[`${side}Team`]);
  const nested = snake ?? camel;
  return {
    id: integerValue(
      first(fixture, [`${side}_team_id`, `${side}TeamId`]) ??
        nested?.id,
      true,
    ),
    name: stringValue(
      first(fixture, [`${side}_team_name`, `${side}TeamName`]) ??
        nested?.name ??
        (typeof fixture[`${side}_team`] === "string"
          ? fixture[`${side}_team`]
          : null),
    ),
  };
}

function scoreValue(fixture: Record<string, unknown>, side: "home" | "away") {
  const score = record(fixture.score);
  const fullTime = record(score?.fullTime);
  return integerValue(
    first(fixture, [`${side}_score`, `${side}Score`]) ??
      fullTime?.[side] ??
      score?.[side],
    true,
  );
}

function parseFixture(value: unknown, index: number): SourceFixture {
  const fixture = record(value);
  if (!fixture) {
    throw new FixtureSyncError(
      "invalid_response",
      `Fixture ${index + 1} is not an object.`,
    );
  }

  const externalFixtureId = stringValue(
    first(fixture, ["external_fixture_id", "externalFixtureId", "id"]),
  );
  const home = teamDetails(fixture, "home");
  const away = teamDetails(fixture, "away");
  const kickoffRaw = stringValue(
    first(fixture, ["kickoff_at", "kickoffAt", "kickoff", "utcDate"]),
  );
  const kickoffDate = kickoffRaw ? new Date(kickoffRaw) : null;
  const rawStatus = stringValue(fixture.status)?.toLowerCase();
  const status = rawStatus?.replaceAll("-", "_") as FixtureStatus | undefined;
  const homeScore = scoreValue(fixture, "home");
  const awayScore = scoreValue(fixture, "away");
  const homeTeamCrestUrl = crestUrlValue(fixture.homeTeamCrestUrl);
  const awayTeamCrestUrl = crestUrlValue(fixture.awayTeamCrestUrl);
  const sourceMatchdayValue = first(fixture, ["matchday", "matchday_number", "matchdayNumber"]);
  const sourceMatchday = sourceMatchdayValue === null
    ? null
    : integerValue(sourceMatchdayValue);

  if (
    !externalFixtureId ||
    !home.name ||
    !away.name ||
    home.name === away.name ||
    !kickoffDate ||
    Number.isNaN(kickoffDate.getTime()) ||
    !status ||
    !FIXTURE_STATUSES.has(status) ||
    home.id === undefined ||
    away.id === undefined ||
    homeScore === undefined ||
    awayScore === undefined ||
    (sourceMatchdayValue !== null && sourceMatchday === undefined) ||
    homeTeamCrestUrl === undefined ||
    awayTeamCrestUrl === undefined
  ) {
    throw new FixtureSyncError(
      "invalid_response",
      `Fixture ${index + 1} contains malformed or unsupported data.`,
    );
  }

  return {
    externalFixtureId,
    homeTeamId: home.id,
    awayTeamId: away.id,
    homeTeamName: home.name,
    awayTeamName: away.name,
    homeTeamCrestUrl,
    awayTeamCrestUrl,
    kickoffAt: kickoffDate.toISOString(),
    status,
    homeScore,
    awayScore,
    sourceMatchday: sourceMatchday ?? null,
  };
}

function parseFixtures(payload: unknown, expectedMatchday: number) {
  const root = record(payload);
  const providerMatchday = getProviderPayloadMatchday(payload);
  if (providerMatchday !== expectedMatchday) {
    throw new FixtureSyncError(
      "invalid_response",
      providerMatchday === null
        ? "Who You Got did not identify the provider matchday in its response."
        : `Who You Got returned matchday ${providerMatchday} for requested matchday ${expectedMatchday}.`,
    );
  }
  const values = Array.isArray(payload) ? payload : root?.fixtures;
  if (!Array.isArray(values) || values.length === 0) {
    throw new FixtureSyncError(
      "invalid_response",
      "Who You Got returned no valid fixture list.",
    );
  }

  const fixtures = values.map(parseFixture);
  if (new Set(fixtures.map((fixture) => fixture.externalFixtureId)).size !== fixtures.length) {
    throw new FixtureSyncError(
      "invalid_response",
      "Who You Got returned duplicate fixture IDs.",
    );
  }
  const mismatched = fixtures.filter(
    (fixture) => fixture.sourceMatchday !== null && fixture.sourceMatchday !== expectedMatchday,
  );
  if (mismatched.length > 0) {
    throw new FixtureSyncError(
      "invalid_response",
      `Who You Got returned ${mismatched.length} fixture(s) outside matchday ${expectedMatchday}.`,
    );
  }
  return fixtures;
}

function seasonName(startYear: number) {
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function deriveMatchdayStatus(
  fixtures: SourceFixture[],
  existingStatus: string | null,
  now = Date.now(),
) {
  const statuses = fixtures.map((fixture) => fixture.status);
  const hasStartedFixture = fixtures.some(
    (fixture) => Date.parse(fixture.kickoffAt) <= now,
  );
  if (statuses.every((status) => status === "scheduled" || status === "timed")) {
    return hasStartedFixture ? "scoring" : "upcoming";
  }
  if (statuses.some((status) => status === "in_play" || status === "paused")) {
    return "scoring";
  }
  if (
    statuses.every((status) =>
      ["finished", "cancelled", "postponed"].includes(status),
    )
  ) {
    return "completed";
  }
  return existingStatus && existingStatus !== "completed"
    ? existingStatus
    : "upcoming";
}

async function fetchFixtures(season: number, matchday: number) {
  const apiUrl = process.env.WHO_YOU_GOT_API_URL?.trim();
  const apiKey = process.env.WHO_YOU_GOT_API_KEY?.trim();
  if (!apiUrl || !apiKey) {
    throw new FixtureSyncError(
      "configuration",
      "Who You Got fixture sync is not configured.",
    );
  }

  let url: URL;
  try {
    url = new URL("/api/shared-football/fixtures", apiUrl);
  } catch {
    throw new FixtureSyncError(
      "configuration",
      "The Who You Got API URL is invalid.",
    );
  }
  url.searchParams.set("season", String(season));
  url.searchParams.set("matchday", String(matchday));

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new FixtureSyncError(
      "upstream",
      timedOut
        ? "Who You Got did not respond within 10 seconds."
        : "Who You Got could not be reached.",
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new FixtureSyncError(
      "authentication",
      "Who You Got rejected the configured credentials.",
    );
  }
  if (response.status === 404) {
    throw new FixtureSyncError(
      "missing_mapping",
      "Who You Got has no season mapping for this request.",
    );
  }
  if (!response.ok) {
    throw new FixtureSyncError(
      "upstream",
      `Who You Got fixture sync failed with status ${response.status}.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new FixtureSyncError(
      "invalid_response",
      "Who You Got returned invalid JSON.",
    );
  }
  return parseFixtures(payload, matchday);
}

function logicalFixtureKey(fixture: {
  home_team_id: number | null;
  away_team_id: number | null;
  home_team_name: string;
  away_team_name: string;
}) {
  return logicalPick8FixtureKey({
    homeTeamId: fixture.home_team_id,
    awayTeamId: fixture.away_team_id,
    homeTeamName: fixture.home_team_name,
    awayTeamName: fixture.away_team_name,
  });
}

function databaseError(operation: string, message: string) {
  return new FixtureSyncError("database", `${operation} failed: ${message}`);
}

/** Syncs one validated Premier League matchday. Callers must enforce access. */
export async function syncWhoYouGotFixtures(input: {
  season: number;
  matchday: number;
}): Promise<FixtureSyncSummary> {
  if (!Number.isInteger(input.season) || input.season < 2000 || input.season > 2100) {
    throw new FixtureSyncError(
      "validation",
      "Season must be a start year between 2000 and 2100.",
    );
  }
  if (!Number.isInteger(input.matchday) || input.matchday < 1 || input.matchday > 38) {
    throw new FixtureSyncError(
      "validation",
      "Matchday must be an integer from 1 to 38.",
    );
  }

  const supabase = createAdminClient();
  const syncedAt = new Date().toISOString();

  const { data: existingSeason, error: seasonReadError } = await supabase
    .from("seasons")
    .select("id, name, is_active")
    .eq("provider_season", input.season)
    .maybeSingle();
  if (seasonReadError) throw databaseError("Reading season", seasonReadError.message);

  let seasonId = existingSeason?.id;
  if (existingSeason) {
    if (existingSeason.name !== seasonName(input.season)) {
      const { error } = await supabase
        .from("seasons")
        .update({ name: seasonName(input.season), updated_at: syncedAt })
        .eq("id", existingSeason.id);
      if (error) throw databaseError("Updating season", error.message);
    }
  } else {
    const { data: activeSeason, error: activeSeasonError } = await supabase
      .from("seasons")
      .select("id")
      .eq("is_active", true)
      .maybeSingle();
    if (activeSeasonError) throw databaseError("Reading active season", activeSeasonError.message);

    const { data, error } = await supabase
      .from("seasons")
      .upsert(
        {
          provider_season: input.season,
          name: seasonName(input.season),
          is_active: !activeSeason,
        },
        { onConflict: "provider_season" },
      )
      .select("id")
      .single();
    if (error) throw databaseError("Upserting season", error.message);
    seasonId = data.id;
  }

  if (!seasonId) throw databaseError("Upserting season", "No season ID was returned.");

  const { data: existingMatchday, error: matchdayReadError } = await supabase
    .from("matchdays")
    .select("id, status, fixture_sync_mode")
    .eq("season_id", seasonId)
    .eq("matchday_number", input.matchday)
    .maybeSingle();
  if (matchdayReadError) throw databaseError("Reading matchday", matchdayReadError.message);
  if (
    existingMatchday &&
    !shouldSyncProviderFixtures(existingMatchday.fixture_sync_mode as "provider" | "manual")
  ) {
    throw new FixtureSyncError(
      "manual_matchday",
      `Matchday ${input.matchday} is manually managed and cannot be provider-synced.`,
    );
  }

  const fixtures = await fetchFixtures(input.season, input.matchday);

  const matchdayStatus = deriveMatchdayStatus(
    fixtures,
    existingMatchday?.status ?? null,
  );
  const locksAt = earliestFixtureKickoff(
    fixtures.map((fixture) => ({ kickoff_at: fixture.kickoffAt })),
  );
  if (!locksAt) throw databaseError("Deriving matchday deadline", "No valid fixture kickoff was returned.");
  const { data: matchday, error: matchdayError } = await supabase
    .from("matchdays")
    .upsert(
      {
        season_id: seasonId,
        matchday_number: input.matchday,
        fixture_sync_mode: "provider",
        status: matchdayStatus,
        locks_at: locksAt,
        updated_at: syncedAt,
      },
      { onConflict: "season_id,matchday_number" },
    )
    .select("id")
    .single();
  if (matchdayError) throw databaseError("Upserting matchday", matchdayError.message);

  const externalIds = fixtures.map((fixture) => fixture.externalFixtureId);
  const { data: existingRows, error: fixtureReadError } = await supabase
    .from("fixtures")
    .select(
      "id, external_fixture_id, matchday_id, home_team_id, away_team_id, home_team_name, away_team_name, home_team_crest_url, away_team_crest_url, kickoff_at, status, home_score, away_score",
    )
    .in("external_fixture_id", externalIds);
  if (fixtureReadError) throw databaseError("Reading fixtures", fixtureReadError.message);
  const existingById = new Map(
    (existingRows ?? []).map((fixture) => [fixture.external_fixture_id, fixture]),
  );
  const { data: existingMatchdayRows, error: matchdayFixtureReadError } = await supabase
    .from("fixtures")
    .select("id, external_fixture_id, matchday_id, home_team_id, away_team_id, home_team_name, away_team_name, home_team_crest_url, away_team_crest_url, kickoff_at, status, home_score, away_score")
    .eq("matchday_id", matchday.id);
  if (matchdayFixtureReadError) {
    throw databaseError("Reading matchday fixtures", matchdayFixtureReadError.message);
  }
  const existingByLogicalFixture = new Map(
    (existingMatchdayRows ?? []).map((fixture) => [logicalFixtureKey(fixture), fixture]),
  );

  const inserts: TablesInsert<"fixtures">[] = [];
  const updates: Array<Pick<
    Tables<"fixtures">,
    | "id"
    | "external_fixture_id"
    | "matchday_id"
    | "home_team_id"
    | "away_team_id"
    | "home_team_name"
    | "away_team_name"
    | "home_team_crest_url"
    | "away_team_crest_url"
    | "kickoff_at"
    | "status"
    | "home_score"
    | "away_score"
  >> = [];
  const unchangedExternalIds: string[] = [];
  let unchanged = 0;

  for (const fixture of fixtures) {
    const existing = existingById.get(fixture.externalFixtureId) ??
      existingByLogicalFixture.get(logicalFixtureKey({
        home_team_id: fixture.homeTeamId,
        away_team_id: fixture.awayTeamId,
        home_team_name: fixture.homeTeamName,
        away_team_name: fixture.awayTeamName,
      }));
    if (!existing) {
      inserts.push({
        matchday_id: matchday.id,
        external_fixture_id: fixture.externalFixtureId,
        home_team_id: fixture.homeTeamId,
        away_team_id: fixture.awayTeamId,
        home_team_name: fixture.homeTeamName,
        away_team_name: fixture.awayTeamName,
        home_team_crest_url: fixture.homeTeamCrestUrl,
        away_team_crest_url: fixture.awayTeamCrestUrl,
        kickoff_at: fixture.kickoffAt,
        status: fixture.status,
        home_score: fixture.homeScore,
        away_score: fixture.awayScore,
        last_synced_at: syncedAt,
      });
    } else if (
      existing.external_fixture_id !== fixture.externalFixtureId ||
      existing.matchday_id !== matchday.id ||
      existing.home_team_id !== fixture.homeTeamId ||
      existing.away_team_id !== fixture.awayTeamId ||
      existing.home_team_name !== fixture.homeTeamName ||
      existing.away_team_name !== fixture.awayTeamName ||
      existing.home_team_crest_url !== fixture.homeTeamCrestUrl ||
      existing.away_team_crest_url !== fixture.awayTeamCrestUrl ||
      !representSameKickoff(existing.kickoff_at, fixture.kickoffAt) ||
      existing.status !== fixture.status ||
      existing.home_score !== fixture.homeScore ||
      existing.away_score !== fixture.awayScore
    ) {
      updates.push({
        id: existing.id,
        external_fixture_id: fixture.externalFixtureId,
        matchday_id: matchday.id,
        home_team_id: fixture.homeTeamId,
        away_team_id: fixture.awayTeamId,
        home_team_name: fixture.homeTeamName,
        away_team_name: fixture.awayTeamName,
        home_team_crest_url: fixture.homeTeamCrestUrl,
        away_team_crest_url: fixture.awayTeamCrestUrl,
        kickoff_at: fixture.kickoffAt,
        status: fixture.status,
        home_score: fixture.homeScore,
        away_score: fixture.awayScore,
      });
    } else {
      unchanged += 1;
      unchangedExternalIds.push(fixture.externalFixtureId);
    }
  }

  if (inserts.length) {
    const { error } = await supabase.from("fixtures").insert(inserts);
    if (error) throw databaseError("Inserting fixtures", error.message);
  }
  for (const fixture of updates) {
    const { error } = await supabase
      .from("fixtures")
      .update({
        external_fixture_id: fixture.external_fixture_id,
        matchday_id: fixture.matchday_id,
        home_team_id: fixture.home_team_id,
        away_team_id: fixture.away_team_id,
        home_team_name: fixture.home_team_name,
        away_team_name: fixture.away_team_name,
        home_team_crest_url: fixture.home_team_crest_url,
        away_team_crest_url: fixture.away_team_crest_url,
        kickoff_at: fixture.kickoff_at,
        status: fixture.status,
        home_score: fixture.home_score,
        away_score: fixture.away_score,
        last_synced_at: syncedAt,
        updated_at: syncedAt,
      })
      .eq("id", fixture.id);
    if (error) throw databaseError("Updating fixture", error.message);
  }
  if (unchangedExternalIds.length) {
    const { error } = await supabase
      .from("fixtures")
      .update({ last_synced_at: syncedAt })
      .in("external_fixture_id", unchangedExternalIds);
    if (error) throw databaseError("Stamping synced fixtures", error.message);
  }

  const { data: matchdayFixtures, error: missingReadError } = await supabase
    .from("fixtures")
    .select("external_fixture_id")
    .eq("matchday_id", matchday.id);
  if (missingReadError) throw databaseError("Checking missing fixtures", missingReadError.message);
  const receivedIds = new Set(externalIds);
  const staleExternalIds = (matchdayFixtures ?? [])
    .map((fixture) => fixture.external_fixture_id)
    .filter((id) => !receivedIds.has(id));

  let removed = 0;
  let invalidatedEntries = 0;
  const potentialRemovals: string[] = [];
  if (staleExternalIds.length) {
    const { data: referencedRows, error: referenceError } = await supabase
      .from("entry_selections")
      .select("entry_id, fixture_id, fixtures!inner(external_fixture_id)")
      .in("fixtures.external_fixture_id", staleExternalIds);
    if (referenceError) throw databaseError("Checking stale fixture selections", referenceError.message);
    const affectedEntryIds = [
      ...new Set((referencedRows ?? []).map((row) => row.entry_id)),
    ];
    const staleFixtureIds = (existingMatchdayRows ?? [])
      .filter((fixture) => staleExternalIds.includes(fixture.external_fixture_id))
      .map((fixture) => fixture.id);

    // The provider set is authoritative. A removed provider fixture cannot be
    // mapped safely to a different match, so any affected submission becomes
    // a truthful draft before its invalid selections and fixture are removed.
    if (affectedEntryIds.length) {
      const { error: entryResetError } = await supabase
        .from("entries")
        .update({
          submitted_at: null,
          calculated_score: null,
          score_calculated_at: null,
          updated_at: syncedAt,
        })
        .in("id", affectedEntryIds)
        .eq("matchday_id", matchday.id);
      if (entryResetError) throw databaseError("Invalidating stale fixture entries", entryResetError.message);
      invalidatedEntries = affectedEntryIds.length;
    }
    if (staleFixtureIds.length) {
      const { error: selectionRemovalError } = await supabase
        .from("entry_selections")
        .delete()
        .in("fixture_id", staleFixtureIds);
      if (selectionRemovalError) throw databaseError("Removing stale fixture selections", selectionRemovalError.message);

      const { error: removalError } = await supabase
        .from("fixtures")
        .delete()
        .eq("matchday_id", matchday.id)
        .in("id", staleFixtureIds);
      if (removalError) throw databaseError("Removing stale fixtures", removalError.message);
      removed = staleFixtureIds.length;
    }
  }

  return {
    season: input.season,
    matchday: input.matchday,
    matchdayStatus,
    received: fixtures.length,
    inserted: inserts.length,
    updated: updates.length,
    unchanged,
    removed,
    invalidatedEntries,
    potentialRemovals,
    syncedAt,
  };
}
