// Supabase's gateway turns an `sb_secret_` key into a short-lived JWT that PostgREST sometimes rejects with
// 401 PGRST303 "JWT issued at future" (clock skew between Supabase components; upstream supabase/supabase#49655,
// #50651). PostgREST rejects the request before running any SQL, so replaying it is safe even for writes.
// Used only where the caller opts in (the cron monitoring client), never as a blanket retry.

export const JWT_SKEW_RETRY_DELAYS_MS = [300, 900] as const;

type Options = {
  delaysMs?: readonly number[];
  sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
  log?: (line: Record<string, unknown>) => void;
};

export function abortableSleep(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(signal?.reason); };
    signal?.addEventListener("abort", stop, { once: true });
  });
}

const defaultLog = (line: Record<string, unknown>) => console.warn(JSON.stringify(line));

/** supabase-js sends JSON strings; anything streamed cannot be replayed, so it is never retried. */
function replayable(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) {
  if (typeof Request !== "undefined" && input instanceof Request) return false;
  const body = init?.body;
  return body === undefined || body === null || typeof body === "string"
    || body instanceof URLSearchParams || body instanceof Uint8Array || body instanceof ArrayBuffer;
}

async function isJwtIssuedInFuture(response: Response) {
  if (response.status !== 401) return false;
  try {
    const body = await response.clone().json() as { code?: unknown; message?: unknown };
    return body.code === "PGRST303" || (typeof body.message === "string" && /issued at future/i.test(body.message));
  } catch {
    return false;
  }
}

export function retryOnJwtIssuedInFuture(base: typeof fetch = globalThis.fetch, options: Options = {}): typeof fetch {
  const { delaysMs = JWT_SKEW_RETRY_DELAYS_MS, sleep = abortableSleep, log = defaultLog } = options;
  return async (input, init) => {
    let response = await base(input, init);
    if (!replayable(input, init)) return response;
    for (let attempt = 0; attempt < delaysMs.length; attempt++) {
      if (init?.signal?.aborted || !(await isJwtIssuedInFuture(response))) return response;
      try {
        log({
          service: "pick8-cron-monitor", event: "jwt_skew_retry", code: "PGRST303",
          attempt: attempt + 1, delayMs: delaysMs[attempt],
        });
      } catch { /* logging cannot alter the request */ }
      void response.body?.cancel().catch(() => {});
      try { await sleep(delaysMs[attempt], init?.signal); } catch { return response; }
      response = await base(input, init);
    }
    return response;
  };
}
