import { classifyCronResult, type Pick8CronClassification, type Pick8CronJob } from "./pick8-cron-monitor.ts";

// Records one execution row around a cron job. The recorder is strictly observational:
// every monitoring read/write is bounded and swallowed, and the job's result or error is returned or
// rethrown exactly as if the recorder did not exist. The start marker is written concurrently with the job;
// the finish write is handed to `defer` (Next's `after`) so it never sits on the response path.

export type CronExecutionFinish = Pick8CronClassification & { finishedAt: string; durationMs: number };

export type CronExecutionStore = {
  /** Insert a `running` row; resolves its id. */
  start(job: Pick8CronJob, startedAt: string): Promise<string>;
  /** Idempotent: sets the same values for the same id, so one retry is safe. */
  finish(id: string, finish: CronExecutionFinish): Promise<void>;
  /** Used only when the start row could not be written. */
  insertFinished(job: Pick8CronJob, startedAt: string, finish: CronExecutionFinish): Promise<void>;
};

export const MONITOR_WRITE_TIMEOUT_MS = 3_000;

type Deps = {
  store: CronExecutionStore;
  now?: () => number;
  timeoutMs?: number;
  log?: (line: Record<string, unknown>) => void;
  /**
   * Schedules the completion bookkeeping to run after the response is sent. If absent, or if it throws
   * (e.g. no request scope), the bookkeeping runs inline instead, so an attempt is never left unrecorded.
   */
  defer?: (task: () => Promise<void>) => void;
};

const defaultLog = (line: Record<string, unknown>) => console.warn(JSON.stringify(line));

async function bounded<T>(
  work: () => Promise<T>, timeoutMs: number, log: (line: Record<string, unknown>) => void,
  job: Pick8CronJob, stage: string,
): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      work(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("monitor timeout")), timeoutMs); }),
    ]);
    return { ok: true, value };
  } catch (error) {
    try {
      log({
        service: "pick8-cron-monitor", event: "record_failed", job, stage, success: false,
        error: (error instanceof Error ? error.message : "Unexpected monitoring failure").slice(0, 200),
      });
    } catch { /* logging cannot alter the job */ }
    return { ok: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function recordCronExecution<T>(job: Pick8CronJob, run: () => Promise<T>, deps: Deps): Promise<T> {
  const { store, now = Date.now, timeoutMs = MONITOR_WRITE_TIMEOUT_MS, log = defaultLog, defer } = deps;
  const startedMs = now();
  const startedAt = new Date(startedMs).toISOString();
  // Start the marker concurrently with the job so monitoring adds no latency on the happy path.
  const started = bounded(() => store.start(job, startedAt), timeoutMs, log, job, "start");

  let result: T | undefined;
  let thrown: unknown;
  let threw = false;
  try {
    result = await run();
  } catch (error) {
    threw = true;
    thrown = error;
  }

  // Duration is the job's, taken before any deferral.
  const finishedMs = now();
  const finalize = async () => {
    try {
      const classification: Pick8CronClassification = threw
        ? {
          outcome: "failure",
          error: (thrown instanceof Error ? thrown.message : "Unexpected automation failure.").slice(0, 300),
          summary: {},
        }
        : classifyCronResult(result);
      const finish: CronExecutionFinish = {
        ...classification, finishedAt: new Date(finishedMs).toISOString(), durationMs: Math.max(0, finishedMs - startedMs),
      };
      const start = await started;
      if (start.ok) {
        const first = await bounded(() => store.finish(start.value, finish), timeoutMs, log, job, "finish");
        if (!first.ok) await bounded(() => store.finish(start.value, finish), timeoutMs, log, job, "finish_retry");
      } else {
        await bounded(() => store.insertFinished(job, startedAt, finish), timeoutMs, log, job, "insert_finished");
      }
    } catch {
      /* Monitoring can never change the job outcome. */
    }
  };
  if (defer) {
    try { defer(finalize); } catch { await finalize(); }
  } else {
    await finalize();
  }

  if (threw) throw thrown;
  return result as T;
}
