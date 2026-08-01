import { FootballDataError } from "@/utils/football-data/client";

export type CronErrorSummary = {
  error: string;
  providerStatus?: number;
  retryAfterSeconds?: number | null;
};

export function getCronScope(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const rawLimit = Number(searchParams.get("limit_configs"));

  return {
    dryRun: searchParams.get("dry_run") === "1",
    seasonId: searchParams.get("season_id")?.trim() || null,
    competitionCode:
      searchParams.get("competition_code")?.trim().toUpperCase() || null,
    limitConfigs:
      Number.isInteger(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 10)
        : null,
  };
}

export function getCronErrorSummary(error: unknown): CronErrorSummary {
  if (error instanceof FootballDataError) {
    return {
      error: error.message,
      providerStatus: error.status,
      retryAfterSeconds: error.resetSeconds,
    };
  }

  return {
    error: error instanceof Error ? error.message : "Unknown cron error",
  };
}

export function createCronDiagnostics({
  route,
  dryRun,
}: {
  route: string;
  dryRun: boolean;
}) {
  const startedAt = performance.now();
  const debugEnabled = process.env.DEBUG_CRON === "1";

  function elapsedMs() {
    return Math.round(performance.now() - startedAt);
  }

  function log(phase: string, details: Record<string, unknown> = {}) {
    if (!debugEnabled) {
      return;
    }

    console.info("[cron]", {
      route,
      phase,
      dryRun,
      elapsedMs: elapsedMs(),
      ...details,
    });
  }

  function logError(
    phase: string,
    error: unknown,
    details: Record<string, unknown> = {},
  ) {
    if (!debugEnabled) {
      return;
    }

    console.error("[cron]", {
      route,
      phase,
      dryRun,
      elapsedMs: elapsedMs(),
      ...details,
      ...getCronErrorSummary(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  return { elapsedMs, log, logError };
}

export function capItems<T>(items: T[] | null | undefined, limit = 5) {
  return (items ?? []).slice(0, limit);
}

export function stripRawPayload<T extends { raw_payload?: unknown }>(item: T) {
  const copy = { ...item };
  delete copy.raw_payload;
  return copy;
}
