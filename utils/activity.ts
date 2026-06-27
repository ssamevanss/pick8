import { createAdminClient } from "@/utils/supabase/admin";

type ActivityNotificationInput = {
  eventKey: string;
  type:
    | "info"
    | "fixtures_selected"
    | "predictions_closing"
    | "results_available"
    | "weekly_winner";
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
};

export async function upsertActivityNotification({
  eventKey,
  type,
  title,
  body,
  metadata = {},
}: ActivityNotificationInput) {
  const supabase = createAdminClient();

  const { error } = await supabase.from("notifications").upsert(
    {
      event_key: eventKey,
      type,
      title,
      body,
      metadata,
    },
    {
      onConflict: "event_key",
    },
  );

  if (error) {
    throw new Error(error.message);
  }
}