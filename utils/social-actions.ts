"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import {
  formatGroupedActorText,
  upsertGroupedUserNotification,
} from "@/utils/user-notifications";
import { requireLeagueMembership } from "@/utils/leagues";

const ALLOWED_REACTIONS = new Set(["😂", "🔥", "👀", "😭", "🤝"]);
const MAX_COMMENT_LENGTH = 240;

type FixtureScopeRow = {
  id: string;
  kickoff_at: string;
  status: string;
  home_team?: string | null;
  away_team?: string | null;
  gameweek_id: string;
  gameweeks:
    | {
        season_id: string;
        seasons:
          | {
              status: string | null;
              league_id: string | null;
            }
          | {
              status: string | null;
              league_id: string | null;
            }[]
          | null;
      }
    | {
        season_id: string;
        seasons:
          | {
              status: string | null;
              league_id: string | null;
            }
          | {
              status: string | null;
              league_id: string | null;
            }[]
          | null;
      }[]
    | null;
};

type NotificationScopeRow = {
  id: string;
  season_id: string | null;
  gameweek_id: string | null;
  type?: string | null;
  title?: string | null;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
  seasons:
    | {
        status: string | null;
        league_id: string | null;
      }
    | {
        status: string | null;
        league_id: string | null;
      }[]
    | null;
};

type NotificationCommentScopeRow = {
  id: string;
  season_id: string;
  gameweek_id: string | null;
  notification_id: string;
  notifications:
    | {
        seasons:
          | {
            status: string | null;
            league_id: string | null;
          }
          | {
              status: string | null;
              league_id: string | null;
            }[]
          | null;
      }
    | {
        seasons:
          | {
              status: string | null;
              league_id: string | null;
            }
          | {
              status: string | null;
              league_id: string | null;
            }[]
          | null;
      }[]
    | null;
};

function getFixtureGameweek(row: FixtureScopeRow) {
  return Array.isArray(row.gameweeks) ? row.gameweeks[0] : row.gameweeks;
}

function getSeasonStatus(
  season:
    | { status: string | null; league_id?: string | null }
    | { status: string | null; league_id?: string | null }[]
    | null
    | undefined,
) {
  return Array.isArray(season) ? season[0]?.status : season?.status;
}

function getSeasonLeagueId(
  season:
    | { league_id?: string | null }
    | { league_id?: string | null }[]
    | null
    | undefined,
) {
  return Array.isArray(season) ? season[0]?.league_id : season?.league_id;
}

function logSocialNotificationInfo(
  stage: string,
  details: Record<string, unknown>,
) {
  if (process.env.DEBUG_NOTIFICATIONS !== "1") {
    return;
  }

  console.info("[user-notifications]", stage, details);
}

function getLeagueTargetHref(leagueId: string, destination: string) {
  return `/leagues/select?league=${encodeURIComponent(
    leagueId,
  )}&next=${encodeURIComponent(destination)}`;
}

async function getApprovedUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { supabase, user: null, profile: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, status")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.status !== "approved") {
    return { supabase, user: null, profile: null };
  }

  return { supabase, user, profile };
}

function getProfileDisplayName(
  profile:
    | { display_name?: string | null }
    | { display_name?: string | null }[]
    | null
    | undefined,
) {
  if (Array.isArray(profile)) {
    return profile[0]?.display_name ?? "Someone";
  }

  return profile?.display_name ?? "Someone";
}

async function getActorName(userId: string) {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  return getProfileDisplayName(profile);
}

async function getLeagueMemberUserIdsExcept({
  admin,
  leagueId,
  excludedUserIds,
}: {
  admin: ReturnType<typeof createAdminClient>;
  leagueId: string;
  excludedUserIds: string[];
}) {
  const { data: memberships, error } = await admin
    .from("league_memberships")
    .select(
      "user_id, profile:profiles!league_memberships_user_id_fkey!inner(status)",
    )
    .eq("league_id", leagueId)
    .eq("status", "active")
    .eq("profile.status", "approved");
  const excluded = new Set(excludedUserIds.filter(Boolean));

  if (error) {
    console.error("[user-notifications] approved recipient lookup failed", {
      message: error.message,
      code: error.code,
    });
    return [];
  }

  return ((memberships as { user_id: string }[] | null) ?? [])
    .map((membership) => membership.user_id)
    .filter((userId) => !excluded.has(userId));
}

function getEmoji(formData: FormData) {
  const emoji = String(formData.get("emoji") ?? "");

  return ALLOWED_REACTIONS.has(emoji) ? emoji : null;
}

export async function togglePredictionReaction(formData: FormData) {
  const emoji = getEmoji(formData);
  const fixtureId = String(formData.get("fixture_id") ?? "");
  const predictionUserId = String(formData.get("prediction_user_id") ?? "");

  if (!emoji || !fixtureId || !predictionUserId) {
    return;
  }

  const { supabase, user } = await getApprovedUser();

  if (!user || user.id === predictionUserId) {
    return;
  }

  const { data: prediction } = await supabase
    .from("predictions")
    .select("fixture_id, user_id, home_score, away_score")
    .eq("fixture_id", fixtureId)
    .eq("user_id", predictionUserId)
    .maybeSingle();

  if (!prediction) {
    return;
  }

  const { data: fixture } = await supabase
    .from("fixtures")
    .select(
      `
      id,
      kickoff_at,
      status,
      home_team,
      away_team,
      gameweek_id,
      gameweeks!inner (
        season_id,
        seasons!inner (
          status,
          league_id
        )
      )
    `,
    )
    .eq("id", fixtureId)
    .maybeSingle();

  if (!fixture) {
    return;
  }

  const typedFixture = fixture as FixtureScopeRow;
  const gameweek = getFixtureGameweek(typedFixture);
  const seasonStatus = getSeasonStatus(gameweek?.seasons);
  const leagueId = getSeasonLeagueId(gameweek?.seasons);
  const isLocked =
    typedFixture.status !== "scheduled" ||
    new Date(typedFixture.kickoff_at) <= new Date();

  if (
    !gameweek?.season_id ||
    !leagueId ||
    seasonStatus !== "active" ||
    !isLocked
  ) {
    return;
  }

  try {
    await requireLeagueMembership(supabase, user.id, leagueId);
  } catch {
    return;
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("prediction_reactions")
    .select("id, emoji")
    .eq("fixture_id", fixtureId)
    .eq("prediction_user_id", predictionUserId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing?.emoji === emoji) {
    await admin.from("prediction_reactions").delete().eq("id", existing.id);
  } else {
    await admin.from("prediction_reactions").upsert(
      {
        season_id: gameweek.season_id,
        gameweek_id: typedFixture.gameweek_id,
        fixture_id: fixtureId,
        prediction_user_id: predictionUserId,
        user_id: user.id,
        emoji,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "fixture_id,prediction_user_id,user_id",
      },
    );

    const actorName = await getActorName(user.id);
    const scoreline =
      typeof prediction.home_score === "number" &&
      typeof prediction.away_score === "number"
        ? `${prediction.home_score}-${prediction.away_score}`
        : "your";
    const matchup =
      typedFixture.home_team && typedFixture.away_team
        ? `${typedFixture.home_team} v ${typedFixture.away_team}`
        : "a fixture";

    logSocialNotificationInfo("prediction reaction notification requested", {
      notificationType: "prediction_reactions",
      actorUserId: user.id,
      recipientUserId: predictionUserId,
      fixtureId,
      gameweekId: typedFixture.gameweek_id,
    });

    await upsertGroupedUserNotification({
      leagueId,
      recipientUserId: predictionUserId,
      actorUserId: user.id,
      actorName,
      notificationType: "prediction_reactions",
      targetType: "prediction",
      targetId: `${fixtureId}:${predictionUserId}`,
      title: "Prediction reaction",
      bodySingular: (name) =>
        `${name} reacted to your ${scoreline} prediction for ${matchup}.`,
      bodyGrouped: (names, otherCount) =>
        `${formatGroupedActorText(
          names,
          otherCount,
        )} reacted to your ${scoreline} prediction for ${matchup}.`,
      metadata: {
        targetHref: getLeagueTargetHref(
          leagueId,
          `/predictions?gameweek=${typedFixture.gameweek_id}&fixture=${fixtureId}#fixture-${fixtureId}`,
        ),
        leagueId,
        fixtureId,
        gameweekId: typedFixture.gameweek_id,
        predictionUserId,
        matchup,
        scoreline,
      },
    });
  }

  revalidatePath("/predictions");
}

async function getNotificationScope(notificationId: string, userId: string) {
  const supabase = await createClient();

  const { data: notification } = await supabase
    .from("notifications")
    .select(
      `
      id,
      type,
      title,
      body,
      metadata,
      season_id,
      gameweek_id,
      seasons (
        status,
        league_id
      )
    `,
    )
    .eq("id", notificationId)
    .maybeSingle();

  if (!notification) {
    return null;
  }

  const typedNotification = notification as NotificationScopeRow;

  if (
    !typedNotification.season_id ||
    getSeasonStatus(typedNotification.seasons) !== "active"
  ) {
    return null;
  }
  const leagueId = getSeasonLeagueId(typedNotification.seasons);

  if (!leagueId) {
    return null;
  }

  try {
    await requireLeagueMembership(supabase, userId, leagueId);
  } catch {
    return null;
  }

  return typedNotification;
}

async function getNotificationCommentScope(commentId: string, userId: string) {
  const supabase = await createClient();

  const { data: comment } = await supabase
    .from("notification_comments")
    .select(
      `
      id,
      season_id,
      gameweek_id,
      notification_id,
      notifications!inner (
        seasons!inner (
          status,
          league_id
        )
      )
    `,
    )
    .eq("id", commentId)
    .maybeSingle();

  if (!comment) {
    return null;
  }

  const typedComment = comment as NotificationCommentScopeRow;
  const notification = Array.isArray(typedComment.notifications)
    ? typedComment.notifications[0]
    : typedComment.notifications;

  if (getSeasonStatus(notification?.seasons) !== "active") {
    return null;
  }
  const leagueId = getSeasonLeagueId(notification?.seasons);

  if (!leagueId) {
    return null;
  }

  try {
    await requireLeagueMembership(supabase, userId, leagueId);
  } catch {
    return null;
  }

  return typedComment;
}

export async function toggleNotificationReaction(formData: FormData) {
  const emoji = getEmoji(formData);
  const notificationId = String(formData.get("notification_id") ?? "");

  if (!emoji || !notificationId) {
    return;
  }

  const { user } = await getApprovedUser();

  if (!user) {
    return;
  }

  const notification = await getNotificationScope(notificationId, user.id);

  if (!notification?.season_id) {
    return;
  }
  const leagueId = getSeasonLeagueId(notification.seasons);

  if (!leagueId) {
    return;
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("notification_reactions")
    .select("id, emoji")
    .eq("notification_id", notificationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing?.emoji === emoji) {
    await admin.from("notification_reactions").delete().eq("id", existing.id);
  } else {
    await admin.from("notification_reactions").upsert(
      {
        season_id: notification.season_id,
        gameweek_id: notification.gameweek_id,
        notification_id: notificationId,
        user_id: user.id,
        emoji,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "notification_id,user_id",
      },
    );

    const recipientUserId = await getActivityOwnerUserId({
      notification,
      admin,
    });
    const actorName = await getActorName(user.id);
    const activityTitle = notification.title ?? "a league activity item";

    logSocialNotificationInfo("activity reaction notification requested", {
      notificationType: "activity_reactions",
      actorUserId: user.id,
      recipientUserId,
      notificationId,
      notificationTypeSource: notification.type ?? null,
    });

    await upsertGroupedUserNotification({
      leagueId,
      recipientUserId,
      actorUserId: user.id,
      actorName,
      notificationType: "activity_reactions",
      targetType: "notification",
      targetId: notificationId,
      title: "Activity reaction",
      bodySingular: (name) => `${name} reacted to ${activityTitle}.`,
      bodyGrouped: (names, otherCount) =>
        `${formatGroupedActorText(names, otherCount)} reacted to ${activityTitle}.`,
      metadata: {
        targetHref: getLeagueTargetHref(
          leagueId,
          `/dashboard?activity=${notificationId}&comments=1#activity-${notificationId}`,
        ),
        leagueId,
        notificationId,
        activityTitle,
      },
    });
  }

  revalidatePath("/dashboard");
}

export async function addNotificationComment(formData: FormData) {
  const notificationId = String(formData.get("notification_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  if (
    !notificationId ||
    body.length === 0 ||
    body.length > MAX_COMMENT_LENGTH
  ) {
    return;
  }

  const { user } = await getApprovedUser();

  if (!user) {
    return;
  }

  const notification = await getNotificationScope(notificationId, user.id);

  if (!notification?.season_id) {
    return;
  }

  const admin = createAdminClient();
  const { data: insertedComment } = await admin
    .from("notification_comments")
    .insert({
      season_id: notification.season_id,
      gameweek_id: notification.gameweek_id,
      notification_id: notificationId,
      user_id: user.id,
      body,
    })
    .select("id, user_id, body, created_at")
    .single();

  const actorName = await getActorName(user.id);
  const activityTitle = notification.title ?? "a league activity item";
  const activityOwnerUserId = await getActivityOwnerUserId({
    notification,
    admin,
  });
  const leagueId = getSeasonLeagueId(notification.seasons);

  if (!leagueId) {
    return;
  }
  const targetHref = getLeagueTargetHref(
    leagueId,
    `/dashboard?activity=${notificationId}&comments=1#activity-${notificationId}`,
  );
  const approvedRecipientIds = await getLeagueMemberUserIdsExcept({
    admin,
    leagueId,
    excludedUserIds: [user.id],
  });

  logSocialNotificationInfo("activity comment notifications requested", {
    notificationType: "activity_comments",
    actorUserId: user.id,
    recipientCount: approvedRecipientIds.length,
    recipientUserIds: approvedRecipientIds,
    notificationId,
    commentId: insertedComment?.id ?? null,
  });

  for (const recipientUserId of approvedRecipientIds) {
    await upsertGroupedUserNotification({
      leagueId,
      recipientUserId,
      actorUserId: user.id,
      actorName,
      notificationType: "activity_comments",
      targetType: "notification",
      targetId: notificationId,
      title: "New activity comment",
      bodySingular: (name) =>
        `${name} commented on ${activityTitle}.`,
      bodyGrouped: (names, otherCount) => {
        const total = names.length + otherCount;
        return `${total} player${total === 1 ? "" : "s"} commented on ${activityTitle}.`;
      },
      metadata: {
        targetHref,
        leagueId,
        notificationId,
        commentId: insertedComment?.id,
        activityTitle,
        latestCommentPreview: body,
        activityOwnerUserId,
      },
    });
  }

  revalidatePath("/dashboard");

  return insertedComment
    ? {
        id: insertedComment.id as string,
        user_id: insertedComment.user_id as string,
        body: insertedComment.body as string,
        created_at: insertedComment.created_at as string,
        display_name: actorName,
      }
    : null;
}

export async function deleteNotificationComment(formData: FormData) {
  const commentId = String(formData.get("comment_id") ?? "");

  if (!commentId) {
    return;
  }

  const { user, profile } = await getApprovedUser();

  if (!user || !profile) {
    return;
  }
  const comment = await getNotificationCommentScope(commentId, user.id);

  if (!comment) {
    return;
  }

  const admin = createAdminClient();
  const { data: userProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  let query = admin.from("notification_comments").delete().eq("id", commentId);

  if (userProfile?.role !== "admin") {
    query = query.eq("user_id", user.id);
  }

  await query;
  revalidatePath("/dashboard");
}

export async function toggleNotificationCommentReaction(formData: FormData) {
  const emoji = getEmoji(formData);
  const commentId = String(formData.get("comment_id") ?? "");

  if (!emoji || !commentId) {
    return;
  }

  const { user } = await getApprovedUser();

  if (!user) {
    return;
  }

  const comment = await getNotificationCommentScope(commentId, user.id);

  if (!comment?.season_id) {
    return;
  }
  const scopedNotification = Array.isArray(comment.notifications)
    ? comment.notifications[0]
    : comment.notifications;
  const leagueId = getSeasonLeagueId(scopedNotification?.seasons);

  if (!leagueId) {
    return;
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("notification_comment_reactions")
    .select("id, emoji")
    .eq("comment_id", commentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing?.emoji === emoji) {
    await admin
      .from("notification_comment_reactions")
      .delete()
      .eq("id", existing.id);
  } else {
    await admin.from("notification_comment_reactions").upsert(
      {
        season_id: comment.season_id,
        gameweek_id: comment.gameweek_id,
        comment_id: commentId,
        user_id: user.id,
        emoji,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "comment_id,user_id",
      },
    );

    const { data: commentOwner } = await admin
      .from("notification_comments")
      .select("user_id, body")
      .eq("id", commentId)
      .maybeSingle();
    const actorName = await getActorName(user.id);
    const commentOwnerUserId =
      (commentOwner as { user_id: string } | null)?.user_id ?? null;

    logSocialNotificationInfo("comment reaction notification requested", {
      notificationType: "comment_reactions",
      actorUserId: user.id,
      recipientUserId: commentOwnerUserId,
      commentId,
      notificationId: comment.notification_id,
    });

    await upsertGroupedUserNotification({
      leagueId,
      recipientUserId: commentOwnerUserId,
      actorUserId: user.id,
      actorName,
      notificationType: "comment_reactions",
      targetType: "comment",
      targetId: commentId,
      title: "Comment reaction",
      bodySingular: (name) => `${name} reacted to your comment.`,
      bodyGrouped: (names, otherCount) =>
        `${formatGroupedActorText(names, otherCount)} reacted to your comment.`,
      metadata: {
        targetHref: getLeagueTargetHref(
          leagueId,
          `/dashboard?activity=${comment.notification_id}&comments=1#activity-${comment.notification_id}`,
        ),
        leagueId,
        commentId,
        notificationId: comment.notification_id,
      },
    });
  }

  revalidatePath("/dashboard");
}

async function getActivityOwnerUserId({
  notification,
  admin,
}: {
  notification: NotificationScopeRow;
  admin: ReturnType<typeof createAdminClient>;
}) {
  if (notification.type !== "fixtures_selected" || !notification.gameweek_id) {
    return null;
  }

  const { data: gameweek } = await admin
    .from("gameweeks")
    .select("fixture_picker_id")
    .eq("id", notification.gameweek_id)
    .maybeSingle();

  return (
    (gameweek as { fixture_picker_id: string | null } | null)
      ?.fixture_picker_id ?? null
  );
}
