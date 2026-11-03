import { currentCronReadContext, cronDeadlineFetch, type CronReadContext } from "@/utils/supabase/cron-read";
import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { abortableSleep, retryOnJwtIssuedInFuture } from "@/utils/supabase/jwt-skew-retry";
import {
  createSupabaseServerFetch,
  type SupabaseResilienceContext,
} from "@/utils/supabase/resilience";

/** Keep this much of the cron budget in hand: a skew replay never spends the last second of an invocation. */
const CRON_RETRY_RESERVE_MS = 1_000;

/**
 * Inside a cron invocation only: replay a PGRST303 "JWT issued at future" rejection (Supabase clock skew). It is
 * rejected before any SQL runs, so a replay cannot duplicate a write. Every replay goes back through
 * `cronDeadlineFetch`, so it is counted, bounded by the invocation deadline and cancelled with it; the backoff
 * is skipped when it would not fit in the remaining budget.
 */
function retryWithinCronDeadline(context: CronReadContext, deadlineFetch: typeof fetch) {
  return retryOnJwtIssuedInFuture(deadlineFetch, {
    sleep: async (ms, signal) => {
      if (context.remaining() <= ms + CRON_RETRY_RESERVE_MS) throw new Error("Cron deadline too close to retry");
      await abortableSleep(ms, signal ? AbortSignal.any([context.signal, signal]) : context.signal);
    },
  });
}

export function createAdminClient(options: { wrapFetch?: (base: typeof fetch) => typeof fetch } = {}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!secretKey) {
    throw new Error("Missing SUPABASE_SECRET_KEY");
  }

  const cronContext = currentCronReadContext();
  const cronFetch = cronContext ? cronDeadlineFetch(cronContext) : undefined;
  // A caller-supplied wrapper (the monitoring client) owns its own retry policy, so it is never retried twice.
  const fetchImpl = options.wrapFetch
    ? options.wrapFetch(cronFetch ?? globalThis.fetch)
    : cronContext && cronFetch ? retryWithinCronDeadline(cronContext, cronFetch) : undefined;
  return createClient<Database>(supabaseUrl, secretKey, {
    ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function createInteractiveAdminClient(options: {
  overallSignal: AbortSignal;
  context: SupabaseResilienceContext;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!secretKey) throw new Error("Missing SUPABASE_SECRET_KEY");

  const dependencyFetch = createSupabaseServerFetch({
    overallSignal: options.overallSignal,
    context: options.context,
  });

  return createClient<Database>(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: dependencyFetch.fetch,
    },
  });
}
