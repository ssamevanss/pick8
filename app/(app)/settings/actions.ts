"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export async function saveEmailPreferences(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.status !== "approved") {
    redirect("/pending");
  }

  const { error } = await supabase.from("user_email_preferences").upsert(
    {
      user_id: user.id,
      predictions_open_enabled:
        formData.get("predictions_open_enabled") === "on",
      prediction_reminders_enabled:
        formData.get("prediction_reminders_enabled") === "on",
      picker_notifications_enabled:
        formData.get("picker_notifications_enabled") === "on",
      weekly_summary_enabled:
        formData.get("weekly_summary_enabled") === "on",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    redirect(
      `/settings?error=${encodeURIComponent(
        error.message.includes("user_email_preferences")
          ? "Email preferences are not ready yet. Run the email preferences SQL migration first."
          : error.message,
      )}`,
    );
  }

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}
