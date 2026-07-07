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

function logUserNotificationError(
  stage: string,
  details: Record<string, unknown>,
) {
  console.error("[user-notifications]", stage, details);
}

function logUserNotificationInfo(
  stage: string,
  details: Record<string, unknown>,
) {
  console.info("[user-notifications]", stage, details);
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
  if (!recipientUserId || !actorUserId) {
    logUserNotificationInfo("skipped missing participant", {
      notificationType,
      targetType,
      targetId,
      recipientUserId: recipientUserId ?? null,
      actorUserId: actorUserId ?? null,
    });
    return;
  }

  if (recipientUserId === actorUserId) {
    logUserNotificationInfo("skipped self notification", {
      notificationType,
      targetType,
      targetId,
      recipientUserId,
      actorUserId,
    });
    return;
  }

  const admin = createAdminClient();
  const { data: recipient, error: recipientError } = await admin
    .from("profiles")
    .select("id, status")
    .eq("id", recipientUserId)
    .maybeSingle();

  if (recipientError) {
    logUserNotificationError("recipient lookup failed", {
      recipientUserId,
      notificationType,
      targetType,
      targetId,
      message: recipientError.message,
    });
    return;
  }

  if (recipient?.status !== "approved") {
    return;
  }

  const groupingKey = `${notificationType}:${targetType}:${targetId}`;

  logUserNotificationInfo("creating", {
    notificationType,
    targetType,
    targetId,
    groupingKey,
    recipientUserId,
    actorUserId,
  });

  const { data: existing, error: existingError } = await admin
    .from("user_notifications")
    .select("id, metadata")
    .eq("user_id", recipientUserId)
    .eq("grouping_key", groupingKey)
    .maybeSingle();

  if (existingError) {
    logUserNotificationError("existing notification lookup failed", {
      recipientUserId,
      groupingKey,
      message: existingError.message,
      code: existingError.code,
    });
    return;
  }

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
  const payload = {
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
  };

  if (typedExisting?.id) {
    const { error: updateError } = await admin
      .from("user_notifications")
      .update(payload)
      .eq("id", typedExisting.id);

    if (updateError) {
      logUserNotificationError("notification update failed", {
        recipientUserId,
        groupingKey,
        message: updateError.message,
        code: updateError.code,
      });
    }

    logUserNotificationInfo("notification updated", {
      recipientUserId,
      groupingKey,
      notificationId: typedExisting.id,
    });

    return;
  }

  const { data: inserted, error: insertError } = await admin
    .from("user_notifications")
    .insert(payload)
    .select("id")
    .single();

  if (!insertError) {
    logUserNotificationInfo("notification inserted", {
      recipientUserId,
      groupingKey,
      notificationId: (inserted as { id: string } | null)?.id ?? null,
    });
    return;
  }

  if (insertError.code === "23505") {
    const { error: retryUpdateError } = await admin
      .from("user_notifications")
      .update(payload)
      .eq("user_id", recipientUserId)
      .eq("grouping_key", groupingKey);

    if (retryUpdateError) {
      logUserNotificationError("notification retry update failed", {
        recipientUserId,
        groupingKey,
        message: retryUpdateError.message,
        code: retryUpdateError.code,
      });
    }

    logUserNotificationInfo("notification retry updated", {
      recipientUserId,
      groupingKey,
    });

    return;
  }

  logUserNotificationError("notification insert failed", {
    recipientUserId,
    groupingKey,
    message: insertError.message,
    code: insertError.code,
  });
}

export function formatGroupedActorText(actorNames: string[], otherCount: number) {
  const names = formatActorNames(actorNames);

  if (otherCount > 0) {
    return `${names} and ${otherCount} other${otherCount === 1 ? "" : "s"}`;
  }

  return names;
}
