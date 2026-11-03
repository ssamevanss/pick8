import { NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isServerAuthUnavailable } from "@/utils/supabase/resilience";
import { handleAuthCallback } from "@/utils/pick8-auth-callback";

export async function GET(request: NextRequest) {
  return handleAuthCallback(request, {
    exchangeCodeForSession: async (code) => {
      const supabase = await createClient();
      return supabase.auth.exchangeCodeForSession(code);
    },
    isServiceUnavailable: isServerAuthUnavailable,
  });
}
