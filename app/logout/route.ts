import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import {
  isServerAuthUnavailable,
  Pick8ServiceUnavailableError,
} from "@/utils/supabase/resilience";

export async function GET() {
  const supabase = await createClient();

  const { error } = await supabase.auth.signOut();
  if (error) {
    if (isServerAuthUnavailable(error)) {
      throw new Pick8ServiceUnavailableError("auth");
    }
    console.error("Pick8 logout failed", { code: error.code, message: error.message });
  }

  redirect("/login");
}
