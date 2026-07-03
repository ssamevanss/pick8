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
  seasonId?: string;
  gameweekId?: string;
  metadata?: Record<string, unknown>;
};

export async function upsertActivityNotification({
  eventKey,
  type,
  title,
  body,
  seasonId,
  gameweekId,
  metadata = {},
}: ActivityNotificationInput) {
  const supabase = createAdminClient();
  const notification = {
    event_key: eventKey,
    type,
    title,
    body,
    metadata,
    ...(seasonId ? { season_id: seasonId } : {}),
    ...(gameweekId ? { gameweek_id: gameweekId } : {}),
  };

  const { error } = await supabase.from("notifications").upsert(
    notification,
    {
      onConflict: "event_key",
    },
  );

  if (error) {
    throw new Error(error.message);
  }
}
