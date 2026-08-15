import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  const supabase = await createClient();

  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Pick8 logout failed", { code: error.code, message: error.message });
  }

  redirect("/login");
}
