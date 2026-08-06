import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Untyped compatibility client for retained, unreachable legacy modules that
 * still describe the pre-Pick8 schema. New Pick8 code must use server.ts.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components cannot set cookies directly.
          }
        },
      },
    },
  );
}
