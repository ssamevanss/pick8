import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

type CompetitionResult = {
  code: string;
  metadataWorked: boolean;
  upcomingWorked: boolean;
  metadataStatus?: number;
  upcomingStatus?: number;
  metadataName?: string;
  metadataId?: string;
  upcomingCount: number;
  error?: string;
};

type ApiCall = {
  label: string;
  url: string;
  status: number;
  ok: boolean;
  attempt: number;
  retriedAfter429: boolean;
  waitedBeforeMs: number;
  waitedAfter429Ms: number;
  rateLimitHeaders: Record<string, string>;
  error?: string;
};

type NormalizedFixture = {
  provider: "football_data";
  external_fixture_id: string;
  external_competition_id: string | null;
  external_competition_code: string | null;
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
  raw_status_score_summary: JsonRecord;
  last_synced_at: string;
};

const API_BASE = "https://api.football-data.org/v4";
const TARGET_COMPETITIONS = ["PL", "PD", "SA", "BL1", "FL1", "WC"] as const;
const RESULTS_PATH = path.join(process.cwd(), "docs", "2.0A-api-spike-results.md");
const ENV_PATH = path.join(process.cwd(), ".env.local");
const REQUEST_DELAY_MS = 6_700;
const RATE_LIMIT_BUFFER_MS = 2_000;

const apiCalls: ApiCall[] = [];
let lastRequestStartedAt = 0;

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envValue(source: string, key: string): string | undefined {
  const lines = source.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);

    if (!match || match[1] !== key) {
      continue;
    }

    const raw = match[2].trim();

    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      return raw.slice(1, -1);
    }

    return raw;
  }

  return undefined;
}

async function readApiKey(): Promise<string> {
  let envFile = "";

  try {
    envFile = await readFile(ENV_PATH, "utf8");
  } catch {
    throw new Error(
      "Missing .env.local. Add FOOTBALL_DATA_API_KEY=... to .env.local before running the spike.",
    );
  }

  const apiKey = envValue(envFile, "FOOTBALL_DATA_API_KEY");

  if (!apiKey) {
    throw new Error(
      "Missing FOOTBALL_DATA_API_KEY in .env.local. The spike will not run without a football-data.org API key.",
    );
  }

  return apiKey;
}

function rateLimitHeaders(headers: Headers): Record<string, string> {
  const interestingHeaders = [
    "x-requests-available",
    "x-requestcounter-reset",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
  ];

  return Object.fromEntries(
    interestingHeaders
      .map((header) => [header, headers.get(header)] as const)
      .filter((entry): entry is [string, string] => entry[1] !== null),
  );
}

function waitFromRateLimitReset(headers: Record<string, string>): number {
  const resetSeconds = Number(headers["x-requestcounter-reset"]);

  if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
    return resetSeconds * 1_000 + RATE_LIMIT_BUFFER_MS;
  }

  return 60_000 + RATE_LIMIT_BUFFER_MS;
}

async function footballDataFetch(
  label: string,
  endpoint: string,
  apiKey: string,
): Promise<{ data: JsonRecord | null; status: number; ok: boolean; error?: string }> {
  const url = `${API_BASE}${endpoint}`;
  let lastResult: { data: JsonRecord | null; status: number; ok: boolean; error?: string } | null = null;

  for (const attempt of [1, 2]) {
    const elapsedSinceLastRequest = Date.now() - lastRequestStartedAt;
    const waitedBeforeMs =
      lastRequestStartedAt === 0 ? 0 : Math.max(REQUEST_DELAY_MS - elapsedSinceLastRequest, 0);

    if (waitedBeforeMs > 0) {
      await sleep(waitedBeforeMs);
    }

    lastRequestStartedAt = Date.now();

    try {
      const response = await fetch(url, {
        headers: {
          "X-Auth-Token": apiKey,
          Accept: "application/json",
        },
      });

      let data: JsonRecord | null = null;
      let parseError: string | undefined;

      try {
        data = (await response.json()) as JsonRecord;
      } catch (error) {
        parseError = error instanceof Error ? error.message : String(error);
      }

      const headers = rateLimitHeaders(response.headers);
      const error = response.ok ? parseError : extractApiError(data) ?? parseError;
      let waitedAfter429Ms = 0;

      if (response.status === 429 && attempt === 1) {
        waitedAfter429Ms = waitFromRateLimitReset(headers);
      }

      apiCalls.push({
        label,
        url,
        status: response.status,
        ok: response.ok,
        attempt,
        retriedAfter429: response.status === 429 && attempt === 1,
        waitedBeforeMs,
        waitedAfter429Ms,
        rateLimitHeaders: headers,
        error,
      });

      lastResult = {
        data,
        status: response.status,
        ok: response.ok,
        error,
      };

      if (response.status === 429 && attempt === 1) {
        console.log(
          `${label}: hit 429, waiting ${Math.round(waitedAfter429Ms / 1_000)}s before one retry.`,
        );
        await sleep(waitedAfter429Ms);
        continue;
      }

      return lastResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      apiCalls.push({
        label,
        url,
        status: 0,
        ok: false,
        attempt,
        retriedAfter429: false,
        waitedBeforeMs,
        waitedAfter429Ms: 0,
        rateLimitHeaders: {},
        error: message,
      });

      lastResult = { data: null, status: 0, ok: false, error: message };

      return lastResult;
    }
  }

  return lastResult ?? { data: null, status: 0, ok: false, error: "Request did not complete." };
}

function extractApiError(data: JsonRecord | null): string | undefined {
  if (!data) {
    return undefined;
  }

  const message = data.message ?? data.error;
  return typeof message === "string" ? message : undefined;
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.reduce<JsonRecord[]>((items, item) => {
        const record = asRecord(item);
        return record ? [...items, record] : items;
      }, [])
    : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeFixture(match: JsonRecord, syncedAt: string): NormalizedFixture {
  const competition = asRecord(match.competition);
  const season = asRecord(match.season);
  const homeTeam = asRecord(match.homeTeam);
  const awayTeam = asRecord(match.awayTeam);
  const score = asRecord(match.score);
  const fullTime = asRecord(score?.fullTime);

  const status = asString(match.status) ?? "UNKNOWN";
  const homeScore = asNumber(fullTime?.home);
  const awayScore = asNumber(fullTime?.away);
  const stage = asString(match.stage);

  return {
    provider: "football_data",
    external_fixture_id: String(match.id ?? ""),
    external_competition_id:
      competition?.id === undefined || competition?.id === null ? null : String(competition.id),
    external_competition_code: asString(competition?.code),
    provider_season: season?.id === undefined || season?.id === null ? null : String(season.id),
    external_round: stage,
    external_matchday: asNumber(match.matchday),
    external_stage: stage,
    external_group: asString(match.group),
    home_team: asString(homeTeam?.name) ?? asString(homeTeam?.shortName) ?? "Unknown home team",
    away_team: asString(awayTeam?.name) ?? asString(awayTeam?.shortName) ?? "Unknown away team",
    kickoff_at: asString(match.utcDate) ?? "",
    status,
    home_score: homeScore,
    away_score: awayScore,
    raw_status_score_summary: {
      status,
      minute: match.minute ?? null,
      score,
      lastUpdated: match.lastUpdated ?? null,
    },
    last_synced_at: syncedAt,
  };
}

function summarizeFixture(fixture: NormalizedFixture): string {
  const score =
    fixture.home_score === null || fixture.away_score === null
      ? "score unavailable"
      : `${fixture.home_score}-${fixture.away_score}`;

  return `${fixture.external_fixture_id}: ${fixture.home_team} vs ${fixture.away_team}, ${fixture.kickoff_at}, ${fixture.status}, ${score}, matchday ${fixture.external_matchday ?? "n/a"}, stage ${fixture.external_stage ?? "n/a"}, group ${fixture.external_group ?? "n/a"}`;
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function scoreFieldSummary(matches: JsonRecord[]): string[] {
  const finishedMatches = matches.filter((match) => match.status === "FINISHED");
  const unfinishedMatches = matches.filter((match) => match.status !== "FINISHED");
  const matchesToSummarize = [...finishedMatches.slice(0, 6), ...unfinishedMatches.slice(0, 2)];

  const summaries = matchesToSummarize.map((match) => {
    const score = asRecord(match.score);
    const fullTime = asRecord(score?.fullTime);
    const halfTime = asRecord(score?.halfTime);
    const winner = score?.winner ?? null;
    const duration = score?.duration ?? null;

    return [
      `id ${String(match.id ?? "unknown")}`,
      `status ${String(match.status ?? "unknown")}`,
      `winner ${String(winner)}`,
      `duration ${String(duration)}`,
      `fullTime ${String(fullTime?.home ?? null)}-${String(fullTime?.away ?? null)}`,
      `halfTime ${String(halfTime?.home ?? null)}-${String(halfTime?.away ?? null)}`,
    ].join(", ");
  });

  return summaries.length ? summaries : ["No score-bearing matches available."];
}

function requestLimitObservations(): string[] {
  const observations = apiCalls
    .map((call) => {
      const headers = Object.entries(call.rateLimitHeaders)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
      const retry = call.retriedAfter429
        ? `; retried after ${Math.round(call.waitedAfter429Ms / 1_000)}s`
        : "";
      const pacing = call.waitedBeforeMs > 0 ? `; paced ${Math.round(call.waitedBeforeMs / 1_000)}s` : "";

      return headers ? `${call.label} attempt ${call.attempt}: ${headers}${pacing}${retry}` : null;
    })
    .filter((line): line is string => Boolean(line));

  return observations.length
    ? observations
    : ["No recognized request-limit headers were returned by the sampled responses."];
}

function renderList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function renderResultsMarkdown(params: {
  generatedAt: string;
  competitions: CompetitionResult[];
  upcomingSamples: NormalizedFixture[];
  completedSamples: NormalizedFixture[];
  batchSamples: NormalizedFixture[];
  batchWorked: boolean;
  batchError?: string;
  statusValues: string[];
  allObservedMatches: JsonRecord[];
  dateFrom: string;
  dateTo: string;
  completedDateFrom: string;
  completedDateTo: string;
  completedSearchNotes: string[];
}): string {
  const competitionsWorked = params.competitions.map((competition) => {
    const worked = competition.metadataWorked || competition.upcomingWorked;
    const details = [
      `metadata: ${competition.metadataWorked ? "worked" : "failed"}${competition.metadataStatus ? ` (${competition.metadataStatus})` : ""}`,
      `upcoming: ${competition.upcomingWorked ? "worked" : "failed"}${competition.upcomingStatus ? ` (${competition.upcomingStatus})` : ""}`,
      `upcoming matches: ${competition.upcomingCount}`,
      competition.metadataName ? `name: ${competition.metadataName}` : null,
      competition.metadataId ? `id: ${competition.metadataId}` : null,
      competition.error ? `error: ${competition.error}` : null,
    ].filter(Boolean);

    return `- ${competition.code}: ${worked ? "worked" : "did not work"} (${details.join("; ")})`;
  });

  const failedOrEmpty = params.competitions
    .filter((competition) => !competition.metadataWorked && !competition.upcomingWorked)
    .map((competition) => `${competition.code}: ${competition.error ?? "No successful metadata or upcoming response."}`);

  const recommendation =
    failedOrEmpty.length === 0 && params.batchWorked && params.completedSamples.length > 0
      ? "Proceed with football-data.org for 2.0B, subject to confirming score freshness on the account tier used for production."
      : "Test API-Football fallback before committing to 2.0B, because one or more core provider assumptions failed or could not be verified.";

  const apiCallRows = apiCalls.map((call, index) => {
    const endpoint = call.url.replace(API_BASE, "");
    const error = call.error ? `; ${call.error}` : "";

    const retry = call.retriedAfter429
      ? `; retry scheduled after ${Math.round(call.waitedAfter429Ms / 1_000)}s`
      : "";

    return `${index + 1}. ${call.label} attempt ${call.attempt}: ${call.status || "network error"} ${endpoint}${error}${retry}`;
  });

  const rateLimit429s = apiCalls.filter((call) => call.status === 429);
  const unrecovered429s = rateLimit429s.filter((call) => {
    const laterSuccess = apiCalls.some(
      (candidate) => candidate.label === call.label && candidate.attempt > call.attempt && candidate.ok,
    );

    return !laterSuccess;
  });

  return `# 2.0A API Spike Results

Generated: ${params.generatedAt}

This file is generated by \`npm run spike:football-data\`. It intentionally contains no API key or secret values.

## 1. Date/time of spike

${params.generatedAt}

## 2. Provider tested

football-data.org v4

## 3. Competitions tested

${renderList([...TARGET_COMPETITIONS])}

## 4. API call count

${apiCalls.length}

${apiCallRows.join("\n")}

Rate-limit handling:

- Conservative delay between requests: ${REQUEST_DELAY_MS}ms.
- 429 responses observed: ${rateLimit429s.length}.
- 429 responses recovered by one retry: ${rateLimit429s.length - unrecovered429s.length}.
- Unrecovered 429 responses: ${unrecovered429s.length}.

## 5. Whether each target competition worked

${competitionsWorked.join("\n")}

## 6. Upcoming fixture sample summary

Window tested: ${params.dateFrom} to ${params.dateTo}

${params.upcomingSamples.length ? renderList(params.upcomingSamples.map(summarizeFixture)) : "- No upcoming fixture samples were returned."}

Normalized sample rows:

\`\`\`json
${renderJson(params.upcomingSamples.slice(0, 6))}
\`\`\`

## 7. Completed fixture sample summary

Window tested: ${params.completedDateFrom} to ${params.completedDateTo}

Search notes:

${params.completedSearchNotes.length ? renderList(params.completedSearchNotes) : "- Combined completed fixture query was enough."}

${params.completedSamples.length ? renderList(params.completedSamples.map(summarizeFixture)) : "- No completed fixture samples were returned."}

Normalized sample rows:

\`\`\`json
${renderJson(params.completedSamples.slice(0, 6))}
\`\`\`

## 8. Batch-by-IDs result

${params.batchWorked ? "Batch-by-IDs request worked." : `Batch-by-IDs request did not work${params.batchError ? `: ${params.batchError}` : "."}`}

${params.batchSamples.length ? renderList(params.batchSamples.map(summarizeFixture)) : "- No batch fixture samples were returned."}

## 9. Status values observed

${params.statusValues.length ? renderList(params.statusValues) : "- No provider status values observed."}

## 10. Score fields observed

${renderList(scoreFieldSummary(params.allObservedMatches))}

## 11. Timezone/kickoff observations

- Provider kickoff field observed: \`utcDate\`.
- Sampled kickoff values are ISO timestamp strings and should be treated as absolute UTC instants.
- Normalized \`kickoff_at\` copies \`utcDate\` directly for later database insertion as \`timestamptz\`.

## 12. Request-limit observations

${renderList(requestLimitObservations())}

## 13. Risks/issues found

${failedOrEmpty.length ? renderList(failedOrEmpty) : "- No competition-level access failures were observed in this run."}
${unrecovered429s.length ? `- ${unrecovered429s.length} request(s) still failed with 429 after retry.` : "- Rate limiting was avoided or recovered by the paced request wrapper in this run."}
${params.completedSamples.length ? "- Completed score shape was observed." : "- Completed score shape is still unverified."}
${params.batchWorked ? "- Batch-by-IDs was verified." : "- Batch-by-IDs is still unverified."}
- This spike confirms response shape, not production score freshness during live match windows.
- Completed fixture availability depends on the date window and season calendar.
- World Cup data can be sparse outside tournament windows; verify again closer to the tournament.

## 14. Recommendation

${recommendation}

## 15. Exact recommended next step for 2.0B

If football-data.org is accepted after reviewing this run, add the external fixture cache migration and a server-only provider client that maps these normalized fields into \`external_fixtures\`. Keep import disabled by default with \`fixture_import_enabled = false\` until an admin-only dry run has been verified.
`;
}

async function main(): Promise<void> {
  const apiKey = await readApiKey();
  const now = new Date();
  const generatedAt = now.toISOString();
  const dateFrom = formatDateOnly(now);
  const dateTo = formatDateOnly(addDays(now, 45));
  const completedDateFrom = formatDateOnly(addDays(now, -370));
  const completedDateTo = formatDateOnly(now);
  const syncedAt = generatedAt;

  const competitions: CompetitionResult[] = [];
  const upcomingMatchesByCompetition = new Map<string, JsonRecord[]>();
  const allObservedMatches: JsonRecord[] = [];
  const completedSearchNotes: string[] = [];

  for (const code of TARGET_COMPETITIONS) {
    const metadata = await footballDataFetch(
      `competition metadata ${code}`,
      `/competitions/${code}`,
      apiKey,
    );
    const metadataCompetition = asRecord(metadata.data);

    const upcoming = await footballDataFetch(
      `upcoming fixtures ${code}`,
      `/competitions/${code}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      apiKey,
    );
    const matches = asArray(upcoming.data?.matches);

    upcomingMatchesByCompetition.set(code, matches);
    allObservedMatches.push(...matches);

    competitions.push({
      code,
      metadataWorked: metadata.ok,
      upcomingWorked: upcoming.ok,
      metadataStatus: metadata.status,
      upcomingStatus: upcoming.status,
      metadataName: asString(metadataCompetition?.name) ?? undefined,
      metadataId:
        metadataCompetition?.id === undefined || metadataCompetition?.id === null
          ? undefined
          : String(metadataCompetition.id),
      upcomingCount: matches.length,
      error: metadata.error ?? upcoming.error,
    });
  }

  const completed = await footballDataFetch(
    "completed fixtures target competitions",
    `/matches?competitions=${TARGET_COMPETITIONS.join(",")}&dateFrom=${completedDateFrom}&dateTo=${completedDateTo}&status=FINISHED`,
    apiKey,
  );
  let completedMatches = asArray(completed.data?.matches);

  completedSearchNotes.push(
    `Combined completed query returned ${completedMatches.length} match(es) with status ${completed.status}.`,
  );

  if (!completed.ok || completedMatches.length === 0) {
    for (const code of TARGET_COMPETITIONS) {
      if (completedMatches.length >= 4) {
        break;
      }

      const competitionCompleted = await footballDataFetch(
        `completed fixtures ${code}`,
        `/competitions/${code}/matches?dateFrom=${completedDateFrom}&dateTo=${completedDateTo}&status=FINISHED`,
        apiKey,
      );
      const matches = asArray(competitionCompleted.data?.matches);

      completedSearchNotes.push(
        `${code} completed query returned ${matches.length} match(es) with status ${competitionCompleted.status}.`,
      );

      completedMatches = [...completedMatches, ...matches].filter((match, index, matchesSoFar) => {
        const id = match.id;
        return matchesSoFar.findIndex((candidate) => candidate.id === id) === index;
      });
    }
  }

  allObservedMatches.push(...completedMatches);

  const batchIds = [
    ...asArray(upcomingMatchesByCompetition.get("PL")).slice(0, 2),
    ...completedMatches.slice(0, 2),
  ]
    .map((match) => match.id)
    .filter((id): id is string | number => typeof id === "string" || typeof id === "number")
    .slice(0, 4);

  let batchWorked = false;
  let batchError: string | undefined;
  let batchMatches: JsonRecord[] = [];

  if (batchIds.length > 0) {
    const batch = await footballDataFetch(
      "batch by fixture ids",
      `/matches?ids=${batchIds.join(",")}`,
      apiKey,
    );

    batchWorked = batch.ok;
    batchError = batch.error;
    batchMatches = asArray(batch.data?.matches);
    allObservedMatches.push(...batchMatches);
  } else {
    batchError = "No fixture IDs were available from upcoming or completed samples.";
  }

  const upcomingSamples = [
    ...asArray(upcomingMatchesByCompetition.get("PL")).slice(0, 4),
    ...TARGET_COMPETITIONS.flatMap((code) => asArray(upcomingMatchesByCompetition.get(code)).slice(0, 1)),
  ]
    .filter((match, index, matches) => {
      const id = match.id;
      return matches.findIndex((candidate) => candidate.id === id) === index;
    })
    .slice(0, 8)
    .map((match) => normalizeFixture(match, syncedAt));

  const completedSamples = completedMatches
    .slice(0, 6)
    .map((match) => normalizeFixture(match, syncedAt));

  const batchSamples = batchMatches.slice(0, 6).map((match) => normalizeFixture(match, syncedAt));

  const statusValues = uniqueSorted(
    allObservedMatches.map((match) => (typeof match.status === "string" ? match.status : null)),
  );

  const markdown = renderResultsMarkdown({
    generatedAt,
    competitions,
    upcomingSamples,
    completedSamples,
    batchSamples,
    batchWorked,
    batchError,
    statusValues,
    allObservedMatches,
    dateFrom,
    dateTo,
    completedDateFrom,
    completedDateTo,
    completedSearchNotes,
  });

  await writeFile(RESULTS_PATH, markdown, "utf8");

  console.log(`football-data.org spike complete.`);
  console.log(`API calls made: ${apiCalls.length}`);
  console.log(`Results written to ${RESULTS_PATH}`);
  console.log(`Observed statuses: ${statusValues.length ? statusValues.join(", ") : "none"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
