import { createAdminClient } from "@/utils/supabase/admin";

type UserNotificationMetadata = {
  actorIds?: string[];
  actorNames?: string[];
  actorCount?: number;
  [key: string]: unknown;
};

type ExistingUserNotification = {
  id: string;
  metadata: UserNotificationMetadata | null;
};

type UpsertGroupedUserNotificationInput = {
  recipientUserId: string | null | undefined;
  actorUserId: string | null | undefined;
  actorName: string;
  notificationType: string;
  targetType: string;
  targetId: string;
  title: string;
  bodySingular: (actorName: string) => string;
  bodyGrouped: (actorNames: string[], otherCount: number) => string;
  metadata?: Record<string, unknown>;
};

function formatActorNames(names: string[]) {
  if (names.length === 0) {
    return "Someone";
  }

  if (names.length === 1) {
    return names[0];
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }

  return `${names[0]}, ${names[1]}`;
}

function buildGroupedBody({
  actorNames,
  bodySingular,
  bodyGrouped,
}: {
  actorNames: string[];
  bodySingular: (actorName: string) => string;
  bodyGrouped: (actorNames: string[], otherCount: number) => string;
}) {
  if (actorNames.length <= 1) {
    return bodySingular(actorNames[0] ?? "Someone");
  }

  return bodyGrouped(actorNames.slice(0, 2), Math.max(0, actorNames.length - 2));
}

export async function upsertGroupedUserNotification({
  recipientUserId,
  actorUserId,
  actorName,
  notificationType,
  targetType,
  targetId,
  title,
  bodySingular,
  bodyGrouped,
  metadata = {},
}: UpsertGroupedUserNotificationInput) {
  if (!recipientUserId || !actorUserId || recipientUserId === actorUserId) {
    return;
  }

  const admin = createAdminClient();
  const { data: recipient } = await admin
    .from("profiles")
    .select("id, status")
    .eq("id", recipientUserId)
    .maybeSingle();

  if (recipient?.status !== "approved") {
    return;
  }

  const groupingKey = `${notificationType}:${targetType}:${targetId}`;
  const { data: existing } = await admin
    .from("user_notifications")
    .select("id, metadata")
    .eq("user_id", recipientUserId)
    .eq("grouping_key", groupingKey)
    .maybeSingle();
  const typedExisting = existing as ExistingUserNotification | null;
  const existingMetadata = typedExisting?.metadata ?? {};
  const actorIds = [...(existingMetadata.actorIds ?? [])];
  const actorNames = [...(existingMetadata.actorNames ?? [])];

  if (!actorIds.includes(actorUserId)) {
    actorIds.push(actorUserId);
    actorNames.push(actorName);
  }

  const nextMetadata = {
    ...existingMetadata,
    ...metadata,
    actorIds,
    actorNames,
    actorCount: actorIds.length,
  };
  const body = buildGroupedBody({
    actorNames,
    bodySingular,
    bodyGrouped,
  });

  await admin.from("user_notifications").upsert(
    {
      user_id: recipientUserId,
      notification_type: notificationType,
      target_type: targetType,
      target_id: targetId,
      grouping_key: groupingKey,
      title,
      body,
      metadata: nextMetadata,
      read_at: null,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id,grouping_key",
    },
  );
}

export function formatGroupedActorText(actorNames: string[], otherCount: number) {
  const names = formatActorNames(actorNames);

  if (otherCount > 0) {
    return `${names} and ${otherCount} other${otherCount === 1 ? "" : "s"}`;
  }

  return names;
}
