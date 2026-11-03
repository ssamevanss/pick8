import "server-only";

import { after } from "next/server";

import { createAdminClient } from "@/utils/supabase/admin";
import { retryOnJwtIssuedInFuture } from "@/utils/supabase/jwt-skew-retry";
import {
  MONITOR_WRITE_TIMEOUT_MS,
  recordCronExecution,
  type CronExecutionStore,
} from "@/utils/pick8-cron-executions";
import {
  evaluateCronHealth,
  MONITORING_SINCE_ENV,
  PICK8_CRON_JOBS,
  resolveMonitoringBaseline,
  type Pick8CronExecution,
  type Pick8CronHealth,
  type Pick8CronJob,
} from "@/utils/pick8-cron-monitor";

const TABLE = "pick8_cron_executions";
const COLUMNS = "job, started_at, finished_at, outcome, duration_ms, error, summary";
/** Enough to cover the 3-run failure window with room for fresh `running` rows. */
const RECENT_LIMIT = 10;

const signal = () => AbortSignal.timeout(MONITOR_WRITE_TIMEOUT_MS);
// Monitoring-only: a PGRST303 clock-skew rejection is replayed with a short backoff inside each call's 3 s bound.
const monitorClient = () => createAdminClient({ wrapFetch: (base) => retryOnJwtIssuedInFuture(base) });

const supabaseStore: CronExecutionStore = {
  async start(job, startedAt) {
    const { data, error } = await monitorClient()
      .from(TABLE).insert({ job, started_at: startedAt, outcome: "running" })
      .select("id").abortSignal(signal()).single();
    if (error || !data) throw new Error(error?.message ?? "No execution id returned");
    return data.id;
  },
  async finish(id, finish) {
    const { error } = await monitorClient().from(TABLE).update({
      finished_at: finish.finishedAt, outcome: finish.outcome, duration_ms: finish.durationMs,
      error: finish.error, summary: finish.summary as never,
    }).eq("id", id).abortSignal(signal());
    if (error) throw new Error(error.message);
  },
  async insertFinished(job, startedAt, finish) {
    const { error } = await monitorClient().from(TABLE).insert({
      job, started_at: startedAt, finished_at: finish.finishedAt, outcome: finish.outcome,
      duration_ms: finish.durationMs, error: finish.error, summary: finish.summary as never,
    }).abortSignal(signal());
    if (error) throw new Error(error.message);
  },
};

/**
 * Run an authenticated cron job and record the attempt. Never alters the job's result or error. The start
 * marker is written alongside the job; completion is recorded in `after()` so it adds no response latency.
 */
export function monitoredCron<T>(job: Pick8CronJob, run: () => Promise<T>) {
  return recordCronExecution(job, run, { store: supabaseStore, defer: (task) => after(task) });
}

/** Read-only snapshot used by the admin page and the health endpoint. Throws if history is unreadable. */
export async function loadCronHealth(
  now: number = Date.now(),
  monitoringSince: string | undefined = process.env[MONITORING_SINCE_ENV],
): Promise<{
  health: Pick8CronHealth;
  executionsByJob: Record<Pick8CronJob, Pick8CronExecution[]>;
}> {
  const client = monitorClient();
  const fail = (error: { message: string }) => new Error(`Cron history unreadable: ${error.message}`);
  // One wave of small indexed reads (<= 3 s each), so the whole snapshot is bounded by a single timeout.
  const [recent, successes, first] = await Promise.all([
    Promise.all(PICK8_CRON_JOBS.map(async (job) => {
      const { data, error } = await client.from(TABLE).select(COLUMNS).eq("job", job)
        .order("started_at", { ascending: false }).limit(RECENT_LIMIT).abortSignal(signal());
      if (error) throw fail(error);
      return [job, (data ?? []) as Pick8CronExecution[]] as const;
    })),
    Promise.all(PICK8_CRON_JOBS.map(async (job) => {
      const { data, error } = await client.from(TABLE).select("started_at").eq("job", job)
        .in("outcome", ["success", "no_op"]).order("started_at", { ascending: false }).limit(1).abortSignal(signal());
      if (error) throw fail(error);
      return [job, data?.[0]?.started_at ?? null] as const;
    })),
    (async () => {
      const { data, error } = await client.from(TABLE).select("started_at")
        .order("started_at", { ascending: true }).limit(1).abortSignal(signal());
      if (error) throw fail(error);
      return data?.[0]?.started_at ?? null;
    })(),
  ]);

  const executionsByJob = Object.fromEntries(recent) as Record<Pick8CronJob, Pick8CronExecution[]>;
  const health = evaluateCronHealth({
    executionsByJob,
    lastSuccessByJob: Object.fromEntries(successes) as Record<Pick8CronJob, string | null>,
    monitoring: resolveMonitoringBaseline(monitoringSince, first),
    now,
  });
  return { health, executionsByJob };
}
