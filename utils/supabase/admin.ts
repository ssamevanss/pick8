import { currentCronReadContext, cronDeadlineFetch } from "@/utils/supabase/cron-read";
import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  createSupabaseServerFetch,
  type SupabaseResilienceContext,
} from "@/utils/supabase/resilience";

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
  const fetchImpl = options.wrapFetch ? options.wrapFetch(cronFetch ?? globalThis.fetch) : cronFetch;
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
