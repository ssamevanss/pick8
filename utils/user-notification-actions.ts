"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

async function getApprovedUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, userId: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.status !== "approved") {
    return { supabase, userId: null };
  }

  return { supabase, userId: user.id };
}

export async function markUserNotificationsRead(formData: FormData) {
  const notificationIds = formData
    .getAll("notification_id")
    .map((value) => String(value))
    .filter(Boolean);
  const { supabase, userId } = await getApprovedUserId();

  if (!userId || notificationIds.length === 0) {
    return;
  }

  await supabase
    .from("user_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .in("id", notificationIds)
    .is("read_at", null);

  revalidatePath("/dashboard");
  revalidatePath("/predictions");
  revalidatePath("/leaderboard");
  revalidatePath("/pick-fixtures");
}

export async function markAllUserNotificationsRead() {
  const { supabase, userId } = await getApprovedUserId();

  if (!userId) {
    return;
  }

  await supabase
    .from("user_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);

  revalidatePath("/dashboard");
  revalidatePath("/predictions");
  revalidatePath("/leaderboard");
  revalidatePath("/pick-fixtures");
}
