const FOOTBALL_DATA_API_BASE = "https://api.football-data.org/v4";

type JsonRecord = Record<string, unknown>;

export type FootballDataStatus =
  | "SCHEDULED"
  | "TIMED"
  | "IN_PLAY"
  | "PAUSED"
  | "FINISHED"
  | "POSTPONED"
  | "SUSPENDED"
  | "CANCELLED"
  | string;

export type FootballDataMatch = JsonRecord;

export type NormalizedFootballDataFixture = {
  provider: "football_data";
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
  status: FootballDataStatus;
  home_score: number | null;
  away_score: number | null;
  raw_payload: FootballDataMatch;
};

type FootballDataFetchResult = {
  data: JsonRecord | null;
  status: number;
  ok: boolean;
  resetSeconds: number | null;
  error?: string;
};

type FetchCompetitionMatchesParams = {
  competitionCode: string;
  dateFrom: string;
  dateTo: string;
  status?: string;
  season?: string;
};

export class FootballDataError extends Error {
  status: number;
  resetSeconds: number | null;

  constructor(message: string, status: number, resetSeconds: number | null) {
    super(message);
    this.name = "FootballDataError";
    this.status = status;
    this.resetSeconds = resetSeconds;
  }
}

function getApiKey() {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (!apiKey) {
    throw new FootballDataError(
      "Missing FOOTBALL_DATA_API_KEY. Add it to server-side env before importing external fixtures.",
      500,
      null,
    );
  }

  return apiKey;
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractProviderError(data: JsonRecord | null) {
  if (!data) {
    return null;
  }

  const message = data.message ?? data.error;

  return typeof message === "string" ? message : null;
}

function getResetSeconds(headers: Headers) {
  const raw = headers.get("x-requestcounter-reset");
  const parsed = raw ? Number(raw) : NaN;

  return Number.isFinite(parsed) ? parsed : null;
}

async function footballDataFetch(endpoint: string): Promise<FootballDataFetchResult> {
  const response = await fetch(`${FOOTBALL_DATA_API_BASE}${endpoint}`, {
    headers: {
      "X-Auth-Token": getApiKey(),
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const resetSeconds = getResetSeconds(response.headers);
  let data: JsonRecord | null = null;

  try {
    data = (await response.json()) as JsonRecord;
  } catch {
    data = null;
  }

  const providerError = extractProviderError(data);

  if (response.status === 429) {
    return {
      data,
      status: response.status,
      ok: false,
      resetSeconds,
      error:
        providerError ??
        `football-data.org rate limit reached. Retry after ${resetSeconds ?? 60} seconds.`,
    };
  }

  if (!response.ok) {
    return {
      data,
      status: response.status,
      ok: false,
      resetSeconds,
      error: providerError ?? `football-data.org request failed with ${response.status}.`,
    };
  }

  return { data, status: response.status, ok: true, resetSeconds };
}

function requireFootballDataSuccess(result: FootballDataFetchResult) {
  if (!result.ok) {
    throw new FootballDataError(
      result.error ?? "football-data.org request failed.",
      result.status,
      result.resetSeconds,
    );
  }
}

export async function fetchCompetitionMatches({
  competitionCode,
  dateFrom,
  dateTo,
  status,
  season,
}: FetchCompetitionMatchesParams) {
  const params = new URLSearchParams({
    dateFrom,
    dateTo,
  });

  if (status) {
    params.set("status", status);
  }

  if (season) {
    params.set("season", season);
  }

  const result = await footballDataFetch(
    `/competitions/${encodeURIComponent(competitionCode)}/matches?${params.toString()}`,
  );

  requireFootballDataSuccess(result);

  const matches = Array.isArray(result.data?.matches)
    ? result.data.matches.flatMap((match) => asRecord(match) ?? [])
    : [];

  return {
    matches,
    request: {
      status: result.status,
      resetSeconds: result.resetSeconds,
    },
  };
}

export function normalizeFootballDataMatch(
  match: FootballDataMatch,
  fallbackCompetitionCode?: string,
): NormalizedFootballDataFixture {
  const competition = asRecord(match.competition);
  const season = asRecord(match.season);
  const homeTeam = asRecord(match.homeTeam);
  const awayTeam = asRecord(match.awayTeam);
  const score = asRecord(match.score);
  const fullTime = asRecord(score?.fullTime);
  const externalFixtureId = match.id === undefined || match.id === null ? "" : String(match.id);
  const competitionCode =
    asString(competition?.code) ?? fallbackCompetitionCode ?? "UNKNOWN";
  const stage = asString(match.stage);

  return {
    provider: "football_data",
    external_fixture_id: externalFixtureId,
    external_competition_id:
      competition?.id === undefined || competition?.id === null ? null : String(competition.id),
    external_competition_code: competitionCode,
    provider_season: season?.id === undefined || season?.id === null ? null : String(season.id),
    external_round: stage,
    external_matchday: asNumber(match.matchday),
    external_stage: stage,
    external_group: asString(match.group),
    home_team: asString(homeTeam?.name) ?? asString(homeTeam?.shortName) ?? "Unknown home team",
    away_team: asString(awayTeam?.name) ?? asString(awayTeam?.shortName) ?? "Unknown away team",
    kickoff_at: asString(match.utcDate) ?? "",
    status: asString(match.status) ?? "UNKNOWN",
    home_score: asNumber(fullTime?.home),
    away_score: asNumber(fullTime?.away),
    raw_payload: match,
  };
}
