import { AsyncLocalStorage } from "node:async_hooks";

// Opt-in SELECT/HEAD resilience only. Never wrap a mutation or an entire job.
export const CRON_READ_BUDGET_MS = 25_000;
export const CRON_READ_ATTEMPT_MS = 6_000;
const TRANSPORT = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"]);
type Result = { error: unknown; status?: number };
type Builder<R> = PromiseLike<R> & { retry(enabled: boolean): Builder<R>; abortSignal?(signal: AbortSignal): Builder<R> };
export type CronReadPolicy = "R" | "L";
type Event = Record<string, string | number | boolean | null>;

function aborted(code: string) {
  return { data: null, count: null, error: { code, message: code === "cron_read_cancelled" ? "Cron read cancelled" : code === "cron_read_attempt_timeout" ? "Cron read attempt timed out" : "Cron read deadline exhausted", details: "", hint: "" }, status: 0, statusText: "" };
}

function abortable<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

export function createCronReadContext({
  signal, budgetMs = CRON_READ_BUDGET_MS, attemptMs = CRON_READ_ATTEMPT_MS,
  now = () => performance.now(), random = Math.random,
  log = (event: Event) => console.info(JSON.stringify(event)),
  summarizeError = structuredCronError,
}: {
  signal?: AbortSignal; budgetMs?: number; attemptMs?: number; now?: () => number;
  random?: () => number; log?: (event: Event) => void;
  summarizeError?: (error: unknown) => Record<string, unknown>;
} = {}) {
  const started = now();
  const deadline = started + budgetMs;
  const deadlineSignal = AbortSignal.timeout(budgetMs);
  const combined = signal ? AbortSignal.any([signal, deadlineSignal]) : deadlineSignal;
  const runId = crypto.randomUUID();
  let active = 0, retries = 0, dropped = 0, attempts = 0;
  let dbRequestCount = 0;
  let queueTotalMs = 0, requestTotalMs = 0;
  const queue: (() => void)[] = [];
  const events: Event[] = [];
  const remaining = () => Math.max(0, deadline - now());
  const cancelled = () => Boolean(signal?.aborted);
  const emit = (operation: string, fields: Event, error?: unknown) => {
    // Only caller-supplied static operation labels; never a query URL or payload.
    const safeOperation = /^[a-z0-9_.:-]{1,80}$/i.test(operation) ? operation : "unlabelled_read";
    let detail: Event = {};
    if (error) {
      try {
        detail = Object.fromEntries(Object.entries(summarizeError(error))
          .filter(([key]) => ["error", "message", "code", "details", "hint", "httpStatus"].includes(key))
          .filter(([, value]) => typeof value === "string" || typeof value === "number")
          .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 256) : value])) as Event;
      } catch { detail = { error: "Error details unavailable" }; }
    }
    queueTotalMs += Number(fields.queueMs ?? 0);
    requestTotalMs += Number(fields.requestMs ?? 0);
    const event = { event: "cron_read", runId, operation: safeOperation, ...detail, ...fields };
    if (events.length < 24) events.push(event); else dropped++;
    try { log(event); } catch { /* Logging cannot alter query results. */ }
  };
  const acquire = async () => {
    if (combined.aborted || remaining() <= 0) throw new Error("deadline");
    if (active < 3) { active++; return; }
    await new Promise<void>((resolve, reject) => {
      const ready = () => { combined.removeEventListener("abort", stop); active++; resolve(); };
      const stop = () => { const index = queue.indexOf(ready); if (index >= 0) queue.splice(index, 1); reject(combined.reason); };
      queue.push(ready);
      combined.addEventListener("abort", stop, { once: true });
    });
  };
  const release = () => { active--; queue.shift()?.(); };
  return {
    signal: combined, remaining, cancelled, attemptMs, random, now, emit, acquire, release,
    consumeRetry: () => { if (retries >= 8) return false; retries++; return true; },
    countDbRequest: () => { dbRequestCount++; },
    countAttempt: () => { attempts++; },
    summary: () => ({ runId, attempts, retries, dbRequestCount, queueTotalMs, requestTotalMs, droppedEvents: dropped, events: [...events] }),
  };
}
export type CronReadContext = ReturnType<typeof createCronReadContext>;

function retryable(result: Result, error?: unknown) {
  const object = (error ?? result.error) as { code?: string; message?: string; cause?: { code?: string } } | null;
  // A known deterministic SQL/PostgREST error must not be retried based on HTTP status alone.
  if (/^[0-9A-Z]{5}$/.test(object?.code ?? "") || /^PGRST/.test(object?.code ?? "")) return false;
  if ([502, 503, 504].includes(result.status ?? 0)) return true;
  if (result.status) return false;
  if (TRANSPORT.has(object?.code ?? "") || TRANSPORT.has(object?.cause?.code ?? "")) return true;
  if (object?.cause?.code || object?.code) return false;
  // PostgREST wraps fetch failures in plain objects and can discard their cause.
  return !result.status && /^(?:TypeError: )?fetch failed$/i.test(object?.message ?? "");
}

export async function runCronRead<R extends Result>(context: CronReadContext, operation: string, factory: () => Builder<R>, policy: CronReadPolicy = "R"): Promise<R> {
  const seen = new WeakSet<object>();
  const stopped = () => aborted(context.cancelled() ? "cron_read_cancelled" : "cron_read_deadline") as unknown as R;
  const maxAttempts = policy === "R" ? 2 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const queuedAt = context.now();
    try { await context.acquire(); } catch {
      context.emit(operation, { outcome: context.cancelled() ? "cancelled" : "deadline_exhausted", attempt: attempt - 1, policy, queueMs: Math.round(context.now() - queuedAt), requestMs: 0, requestStarted: false, budgetRemainingMs: Math.round(context.remaining()) });
      return stopped();
    }
    let result: R, thrown: unknown, retryAfterMs = 0, timedOut = false;
    const started = context.now();
    const queueMs = Math.round(started - queuedAt);
    let requestStartedAt: number | undefined;
    try {
      if (context.signal.aborted || context.remaining() <= 0) {
        context.emit(operation, { policy, attempt: attempt - 1, queueMs, requestMs: 0, requestStarted: false, outcome: "deadline_exhausted" });
        return stopped();
      }
      const builder = factory();
      if (seen.has(builder)) throw new Error("cron_read_unsafe_operation");
      seen.add(builder);
      // Inspect the installed PostgREST builder before awaiting it: mutation
      // builders also have retry/abortSignal, so method checks are essential.
      const transport = builder as unknown as { method: string; url: URL; fetch?: typeof fetch };
      if (!["GET", "HEAD"].includes(transport.method) || !(transport.url instanceof URL) ||
          !/^\/rest\/v1\/[^/]+$/.test(transport.url.pathname) || transport.url.pathname.includes("/rpc")) {
        throw new Error("cron_read_unsafe_operation");
      }
      // Request-local response header capture; never replace global fetch.
      if (transport.fetch) {
        const fetchImpl = transport.fetch;
        transport.fetch = async (input, init) => {
          const response = await fetchImpl(input, init);
          const header = response.headers.get("retry-after");
          if (header) {
            const seconds = Number(header);
            retryAfterMs = Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now());
            if (!Number.isFinite(retryAfterMs)) retryAfterMs = 0;
          }
          return response;
        };
      }
      // When the invocation deadline is sooner, use that signal directly.
      // Rounding a second timer down can release slots just before the shared
      // deadline and accidentally start queued work in that final millisecond.
      const timeout = context.attemptMs < context.remaining()
        ? AbortSignal.timeout(context.attemptMs) : undefined;
      const signal = timeout ? AbortSignal.any([context.signal, timeout]) : context.signal;
      context.countAttempt();
      try {
        requestStartedAt = context.now();
        result = await abortable(withSignal(builder.retry(false), signal), signal);
      }
      catch (error) { thrown = error; result = { ...aborted("cron_read_attempt_timeout"), error } as unknown as R; }
      timedOut = Boolean(timeout?.aborted) && !context.signal.aborted;
      if (timedOut) result = aborted("cron_read_attempt_timeout") as unknown as R;
    } catch (error) {
      // Invalid builders/programming errors never trigger another query.
      thrown = error;
      result = { ...aborted("cron_read_failed"), error: { code: "cron_read_failed", message: error instanceof Error && error.message === "cron_read_unsafe_operation" ? error.message : "Cron read failed" } } as unknown as R;
    } finally { context.release(); }
    const requestMs = requestStartedAt === undefined ? 0 : Math.round(context.now() - requestStartedAt);
    const timing = { policy, queueMs, requestMs, requestStarted: requestStartedAt !== undefined, elapsedMs: Math.round(context.now() - queuedAt), budgetRemainingMs: Math.round(context.remaining()) };
    if (context.signal.aborted || context.remaining() <= 0) {
      context.emit(operation, { attempt, ...timing, outcome: context.cancelled() ? "cancelled" : "deadline_exhausted" });
      return stopped();
    }
    if (!result.error) { context.emit(operation, { attempt, ...timing, outcome: "success", httpStatus: result.status ?? 0 }); return result; }
    const delayMs = Math.ceil(Math.max(retryAfterMs, context.random() * Math.min(2000, 750 * 2 ** (attempt - 1))));
    const canRetry = (timedOut || retryable(result, thrown)) && attempt < maxAttempts;
    const retry = canRetry && delayMs < context.remaining() && context.consumeRetry();
    context.emit(operation, { attempt, ...timing, httpStatus: result.status ?? 0, outcome: retry ? "retry" : "failed", backoffMs: retry ? delayMs : 0,
      stopReason: retry ? "" : policy === "L" ? "limit_only" : attempt === maxAttempts ? "attempts_exhausted" : !canRetry ? "not_retryable" : delayMs >= context.remaining() ? "insufficient_deadline" : "retry_budget_exhausted",
    }, { error: result.error, status: result.status });
    if (!retry) return result;
    try {
      await new Promise<void>((resolve, reject) => {
        const stop = () => { clearTimeout(timer); reject(context.signal.reason); };
        const timer = setTimeout(() => { context.signal.removeEventListener("abort", stop); resolve(); }, delayMs);
        context.signal.addEventListener("abort", stop, { once: true });
        if (context.signal.aborted) stop();
      });
    } catch {
      context.emit(operation, { attempt, outcome: context.cancelled() ? "cancelled" : "deadline_exhausted" });
      return stopped();
    }
  }
  return stopped();
}

// Monitoring mutations are attempted ONCE, with the same remaining deadline.
export function boundCronMonitoring<R>(context: CronReadContext | undefined, factory: () => Builder<R>): PromiseLike<R> {
  if (!context) return factory();
  if (context.signal.aborted || context.remaining() <= 0) throw new Error("Cron monitoring deadline exhausted");
  return abortable(withSignal(factory().retry(false), context.signal), context.signal);
}

// maybeSingle()/single() return PostgrestBuilder, which retains the signal
// property but does not expose PostgrestTransformBuilder.abortSignal().
function withSignal<R>(builder: Builder<R>, signal: AbortSignal): Builder<R> {
  if (builder.abortSignal) return builder.abortSignal(signal);
  (builder as unknown as { signal: AbortSignal }).signal = signal;
  return builder;
}

// Preserve existing result/error handling. Helpers that previously ignored
// read errors opt into requireSuccess to avoid consuming failed reads as empty
// scoring/activity input. Non-cron consumers retain their existing behavior.
export async function readForCron<R extends Result>(
  context: CronReadContext | undefined, policy: CronReadPolicy,
  operation: string, factory: () => Builder<R>, requireSuccess = false,
): Promise<R> {
  if (!context) return factory();
  const result = await runCronRead(context, operation, factory, policy);
  if (requireSuccess && result.error) throw { error: result.error, status: result.status };
  return result;
}

/** Keep the original dependency fields before callers add their operation label. */
export function structuredCronError(value: unknown): Record<string, unknown> {
  const result = value as { error?: unknown; status?: number } | null;
  const error = (result?.error ?? value) as Record<string, unknown> | null;
  return { httpStatus: result?.status ?? 0, code: error?.code ?? "",
    message: error?.message ?? "Unknown dependency failure", details: error?.details ?? "", hint: error?.hint ?? "" };
}

const invocation = new AsyncLocalStorage<CronReadContext>();

export function currentCronReadContext() { return invocation.getStore(); }

export async function withCronReadContext<T>(work: () => Promise<T>): Promise<T> {
  if (invocation.getStore()) return work();
  const context = createCronReadContext();
  try { return await invocation.run(context, work); }
  finally { console.info(JSON.stringify({ service: "pick8-cron-read-summary", ...context.summary() })); }
}

/** Explicit read sites opt in; interactive/admin callers keep existing behavior. */
export function cronRead<R extends Result>(operation: string, factory: () => Builder<R>): PromiseLike<R> {
  const context = invocation.getStore();
  return context ? runCronRead(context, operation, factory) : factory();
}

/** Classification only: never dispatch or repeat a mutation here. */
export function isAmbiguousWriteResult(result: Result) {
  return retryable(result) || (!result.status && /abort|timeout/i.test(String((result.error as { message?: string } | null)?.message ?? "")));
}

/** One attempt for writes, bounded by the invocation; GET retries live at read sites. */
export function cronDeadlineFetch(context: CronReadContext, fetchImpl: typeof fetch = globalThis.fetch): typeof fetch {
  return (input, init) => {
    context.signal.throwIfAborted();
    if (context.remaining() <= 0) throw new Error("Cron invocation deadline exhausted");
    context.countDbRequest();
    const signal = init?.signal ? AbortSignal.any([context.signal, init.signal]) : context.signal;
    return fetchImpl(input, { ...init, signal });
  };
}
