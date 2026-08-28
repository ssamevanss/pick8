import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database.types";
import {
  createSupabaseServerFetch,
  type SupabaseResilienceContext,
} from "@/utils/supabase/resilience";

export async function createClient(options: {
  overallSignal?: AbortSignal;
  context?: SupabaseResilienceContext;
  databaseReadTimeoutMs?: number;
  databaseMutationTimeoutMs?: number;
} = {}) {
  const cookieStore = await cookies();
  const dependencyFetch = createSupabaseServerFetch({
    overallSignal: options.overallSignal,
    context: options.context,
    databaseReadTimeoutMs: options.databaseReadTimeoutMs,
    databaseMutationTimeoutMs: options.databaseMutationTimeoutMs,
  });

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          if (dependencyFetch.shouldPreserveSession()) return;
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components cannot set cookies directly.
          }
        },
      },
      global: {
        fetch: dependencyFetch.fetch,
      },
    },
  );
}
