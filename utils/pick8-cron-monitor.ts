// Pure monitoring rules for the three Pick8 automation jobs. No I/O, so it is unit-tested directly.

export const PICK8_CRON_JOBS = ["sync-results", "sync-fixtures", "reconcile-results"] as const;
export type Pick8CronJob = (typeof PICK8_CRON_JOBS)[number];
export type Pick8CronOutcome = "running" | "success" | "no_op" | "failure";

export type Pick8CronExecution = {
  job: Pick8CronJob;
  started_at: string;
  finished_at: string | null;
  outcome: Pick8CronOutcome;
  duration_ms: number | null;
  error: string | null;
  summary: Record<string, unknown>;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Schedule =
  | { kind: "interval"; label: string; missedAfterMs: number; failingAfter: number }
  | { kind: "daily"; label: string; hourUtc: number; minuteUtc: number; graceMs: number };

/**
 * Expected cadence. `sync-results` is driven by an external scheduler (cron-job.org, every <= 5 min);
 * three missed beats are required before it is "missed". The daily jobs run on Vercel crons, whose
 * start time can drift by up to an hour, so they get a wide grace window.
 */
export const PICK8_CRON_SCHEDULES: Record<Pick8CronJob, Schedule> = {
  "sync-results": { kind: "interval", label: "Every 5 minutes", missedAfterMs: 15 * MINUTE, failingAfter: 3 },
  "sync-fixtures": { kind: "daily", label: "Daily 02:15 UTC", hourUtc: 2, minuteUtc: 15, graceMs: 2 * HOUR },
  "reconcile-results": { kind: "daily", label: "Daily 05:30 UTC", hourUtc: 5, minuteUtc: 30, graceMs: 2 * HOUR },
};

/** A `running` row this old was killed (timeout, crash, redeploy) before it could record a result. */
export const RUNNING_STALE_MS = 10 * MINUTE;
/** Daily attempts that start slightly before the nominal time still count for that day. */
const EARLY_TOLERANCE_MS = 30 * MINUTE;
/** A daily run is only expected once monitoring has existed for this long before its due time. */
const BOOTSTRAP_MARGIN_MS = HOUR;

export type Pick8CronJobStatus = "healthy" | "awaiting_first_run" | "missed" | "failing";

export type Pick8CronJobHealth = {
  job: Pick8CronJob;
  schedule: string;
  status: Pick8CronJobStatus;
  reason: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastOutcome: Pick8CronOutcome | null;
  lastError: string | null;
};

/** Optional env: ISO-8601 instant (with Z/offset) from which the schedules are expected to be met. */
export const MONITORING_SINCE_ENV = "PICK8_CRON_MONITORING_SINCE";

/**
 * Where "monitoring began" comes from. `configured` is the activation baseline set by the operator, which is
 * what lets a job that has never recorded a row still be reported missed. `first_run` is the fallback (earliest
 * row of any job), `none` means nothing is recorded and nothing is configured (nothing can be missed yet), and
 * `invalid_config` means the env value was set but unusable (reported unhealthy so it cannot silently disarm).
 */
export type Pick8MonitoringSource = "configured" | "first_run" | "none" | "invalid_config";
export type Pick8MonitoringBaseline = { baselineAt: string | null; source: Pick8MonitoringSource };

export type Pick8CronHealth = {
  healthy: boolean;
  checkedAt: string;
  monitoring: { since: string | null; source: Pick8MonitoringSource };
  jobs: Pick8CronJobHealth[];
};

// Date.parse would read a zone-less string in server-local time; require an explicit zone instead.
const STRICT_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function resolveMonitoringBaseline(configured: string | undefined, firstRunAt: string | null): Pick8MonitoringBaseline {
  const raw = configured?.trim();
  if (raw) {
    const parsed = STRICT_ISO.test(raw) ? Date.parse(raw) : NaN;
    if (Number.isFinite(parsed)) return { baselineAt: new Date(parsed).toISOString(), source: "configured" };
    return { baselineAt: firstRunAt, source: "invalid_config" };
  }
  return firstRunAt ? { baselineAt: firstRunAt, source: "first_run" } : { baselineAt: null, source: "none" };
}

const ms = (value: string | null | undefined) => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/** The outcome that counts for failure/recovery rules: stale `running` rows are interruptions. */
export function effectiveOutcome(execution: Pick8CronExecution, now: number): Pick8CronOutcome {
  if (execution.outcome !== "running") return execution.outcome;
  const started = ms(execution.started_at);
  return started !== null && now - started > RUNNING_STALE_MS ? "failure" : "running";
}

/** Latest scheduled instant (UTC) whose grace window has fully elapsed at `now`. */
export function latestDailyDeadlineDue(schedule: Extract<Schedule, { kind: "daily" }>, now: number) {
  const dayStart = Date.UTC(
    new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate(),
  );
  for (let back = 0; back <= 2; back++) {
    const due = dayStart - back * 24 * HOUR + schedule.hourUtc * HOUR + schedule.minuteUtc * MINUTE;
    if (due + schedule.graceMs <= now) return due;
  }
  return null;
}

function iso(value: number | null) {
  return value === null ? null : new Date(value).toISOString();
}

/**
 * @param executions newest first (any length >= the job's `failingAfter`); only this job's rows.
 * @param baselineAt when monitoring began (see `resolveMonitoringBaseline`). Nothing is "missed" before it,
 *   so deploying this feature or an empty table cannot raise an alert; after it, a job with no rows is missed.
 */
export function evaluateCronJob({
  job, executions, lastSuccessAt, baselineAt, now,
}: {
  job: Pick8CronJob;
  executions: Pick8CronExecution[];
  lastSuccessAt: string | null;
  baselineAt: string | null;
  now: number;
}): Pick8CronJobHealth {
  const schedule = PICK8_CRON_SCHEDULES[job];
  const latest = executions[0] ?? null;
  const lastAttempt = ms(latest?.started_at);
  const baseline = ms(baselineAt);
  const base = {
    job, schedule: schedule.label, lastAttemptAt: latest?.started_at ?? null, lastSuccessAt,
    lastOutcome: latest ? effectiveOutcome(latest, now) : null,
    lastError: latest?.outcome === "failure" || (latest && effectiveOutcome(latest, now) === "failure")
      ? latest.error ?? (latest.outcome === "running" ? "Run did not finish." : null) : null,
  };
  const result = (status: Pick8CronJobStatus, reason: string): Pick8CronJobHealth => ({ ...base, status, reason });

  if (baseline === null) {
    return result("awaiting_first_run", `Monitoring is not armed: no run recorded and ${MONITORING_SINCE_ENV} is not set.`);
  }
  if (baseline > now) return result("awaiting_first_run", `Monitoring starts at ${iso(baseline)}.`);

  // 1. Missed: no attempt at all (success, no-op or failure all prove the scheduler fired).
  if (schedule.kind === "interval") {
    const reference = Math.max(lastAttempt ?? baseline, baseline);
    if (now - reference > schedule.missedAfterMs) {
      return result("missed", lastAttempt === null
        ? "No run recorded since monitoring began."
        : `No run since ${iso(lastAttempt)}.`);
    }
  } else {
    const due = latestDailyDeadlineDue(schedule, now);
    if (due !== null && due - BOOTSTRAP_MARGIN_MS >= baseline) {
      const attempted = lastAttempt !== null && lastAttempt >= due - EARLY_TOLERANCE_MS;
      if (!attempted) return result("missed", `No run recorded for the ${iso(due)} schedule.`);
    } else if (latest === null) {
      return result("awaiting_first_run", "Waiting for the first scheduled run after monitoring began.");
    }
  }

  // 2. Failing: a run that finished (or was interrupted) unsuccessfully. Fresh `running` rows are ignored.
  const settled = executions.filter((row) =>
    effectiveOutcome(row, now) !== "running" && (ms(row.started_at) ?? 0) >= baseline);
  const failureWindow = schedule.kind === "interval" ? schedule.failingAfter : 1;
  const recent = settled.slice(0, failureWindow);
  if (recent.length === failureWindow && recent.every((row) => effectiveOutcome(row, now) === "failure")) {
    return result("failing", failureWindow === 1
      ? "The latest run failed."
      : `The latest ${failureWindow} runs failed.`);
  }
  return result("healthy", latest ? "Running as scheduled." : "Waiting for the first scheduled run.");
}

export function evaluateCronHealth({
  executionsByJob, lastSuccessByJob, monitoring, now,
}: {
  executionsByJob: Record<Pick8CronJob, Pick8CronExecution[]>;
  lastSuccessByJob: Record<Pick8CronJob, string | null>;
  monitoring: Pick8MonitoringBaseline;
  now: number;
}): Pick8CronHealth {
  const jobs = PICK8_CRON_JOBS.map((job) => evaluateCronJob({
    job, executions: executionsByJob[job] ?? [], lastSuccessAt: lastSuccessByJob[job] ?? null,
    baselineAt: monitoring.baselineAt, now,
  }));
  return {
    healthy: monitoring.source !== "invalid_config"
      && jobs.every((job) => job.status === "healthy" || job.status === "awaiting_first_run"),
    checkedAt: new Date(now).toISOString(),
    monitoring: { since: monitoring.baselineAt, source: monitoring.source },
    jobs,
  };
}

export type Pick8CronClassification = {
  outcome: Exclude<Pick8CronOutcome, "running">;
  error: string | null;
  summary: Record<string, unknown>;
};

const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);

/**
 * Decide the recorded outcome from the job's response body. The routes return HTTP 200 for business
 * failures (`ok: false` with `failures[]`), so the body, not the status, is authoritative.
 * `skipped` (no active season, nothing due) is a legitimate no-op.
 */
export function classifyCronResult(result: unknown): Pick8CronClassification {
  const body = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  const summary: Record<string, unknown> = {
    matchdays: count(body.matchdaysAttempted),
    failures: count(body.failures),
    deferred: count(body.deferred),
    ...(typeof body.complete === "boolean" ? { complete: body.complete } : {}),
  };
  if (body.ok === false) {
    const first = Array.isArray(body.failures) ? (body.failures[0] as { error?: unknown } | undefined) : undefined;
    const message = typeof first?.error === "string" ? first.error
      : typeof body.error === "string" ? body.error : "Run reported ok: false.";
    return { outcome: "failure", error: message.slice(0, 300), summary };
  }
  if (body.skipped === true) return { outcome: "no_op", error: null, summary };
  return { outcome: "success", error: null, summary };
}
