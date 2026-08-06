import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";
import type { Tables, TablesInsert } from "@/types/database.types";

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
};

export type FixtureSyncSummary = {
  season: number;
  matchday: number;
  matchdayStatus: string;
  received: number;
  inserted: number;
  updated: number;
  unchanged: number;
  potentialRemovals: string[];
  syncedAt: string;
};

export class FixtureSyncError extends Error {
  constructor(
    public readonly code:
      | "validation"
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
  };
}

function parseFixtures(payload: unknown) {
  const root = record(payload);
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
  return fixtures;
}

function seasonName(startYear: number) {
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function deriveMatchdayStatus(
  fixtures: SourceFixture[],
  existingStatus: string | null,
) {
  const statuses = fixtures.map((fixture) => fixture.status);
  if (statuses.every((status) => status === "scheduled" || status === "timed")) {
    return "upcoming";
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
  return parseFixtures(payload);
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

  const fixtures = await fetchFixtures(input.season, input.matchday);
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
    .select("id, status")
    .eq("season_id", seasonId)
    .eq("matchday_number", input.matchday)
    .maybeSingle();
  if (matchdayReadError) throw databaseError("Reading matchday", matchdayReadError.message);

  const matchdayStatus = deriveMatchdayStatus(
    fixtures,
    existingMatchday?.status ?? null,
  );
  const locksAt = fixtures.reduce(
    (earliest, fixture) =>
      fixture.kickoffAt < earliest ? fixture.kickoffAt : earliest,
    fixtures[0].kickoffAt,
  );
  const { data: matchday, error: matchdayError } = await supabase
    .from("matchdays")
    .upsert(
      {
        season_id: seasonId,
        matchday_number: input.matchday,
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
      "external_fixture_id, matchday_id, home_team_id, away_team_id, home_team_name, away_team_name, home_team_crest_url, away_team_crest_url, kickoff_at, status, home_score, away_score",
    )
    .in("external_fixture_id", externalIds);
  if (fixtureReadError) throw databaseError("Reading fixtures", fixtureReadError.message);
  const existingById = new Map(
    (existingRows ?? []).map((fixture) => [fixture.external_fixture_id, fixture]),
  );

  const inserts: TablesInsert<"fixtures">[] = [];
  const updates: Array<Pick<
    Tables<"fixtures">,
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
    const existing = existingById.get(fixture.externalFixtureId);
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
      existing.matchday_id !== matchday.id ||
      existing.home_team_id !== fixture.homeTeamId ||
      existing.away_team_id !== fixture.awayTeamId ||
      existing.home_team_name !== fixture.homeTeamName ||
      existing.away_team_name !== fixture.awayTeamName ||
      existing.home_team_crest_url !== fixture.homeTeamCrestUrl ||
      existing.away_team_crest_url !== fixture.awayTeamCrestUrl ||
      existing.kickoff_at !== fixture.kickoffAt ||
      existing.status !== fixture.status ||
      existing.home_score !== fixture.homeScore ||
      existing.away_score !== fixture.awayScore
    ) {
      updates.push({
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
      .eq("external_fixture_id", fixture.external_fixture_id);
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
  const potentialRemovals = (matchdayFixtures ?? [])
    .map((fixture) => fixture.external_fixture_id)
    .filter((id) => !receivedIds.has(id));

  return {
    season: input.season,
    matchday: input.matchday,
    matchdayStatus,
    received: fixtures.length,
    inserted: inserts.length,
    updated: updates.length,
    unchanged,
    potentialRemovals,
    syncedAt,
  };
}
