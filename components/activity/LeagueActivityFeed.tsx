import ActivityCommentForm from "@/components/activity/ActivityCommentForm";
import EmojiReactionControls from "@/components/social/EmojiReactionControls";
import type { ReactionSummary } from "@/components/predictions/types";
import TeamIdentity from "@/components/predictions/TeamIdentity";
import {
  deleteNotificationComment,
  toggleNotificationCommentReaction,
  toggleNotificationReaction,
} from "@/utils/social-actions";

type NotificationRow = {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  created_at: string;
  metadata: ActivityMetadata | null;
  reactions?: ReactionSummary[];
  comments?: NotificationComment[];
};

type NotificationComment = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  reactions?: ReactionSummary[];
  profiles:
    | {
        display_name: string;
      }
    | {
        display_name: string;
      }[]
    | null;
};

type ActivityMetadata = {
  gameweekName?: string;
  pickerName?: string;
  kickoffText?: string;
  fixtures?: ActivityFixture[];
  weeklyLeaderboard?: WeeklyLeaderboardRow[];
  weeklyWinners?: WeeklyWinner[];
  biggestRisers?: MovementRow[];
  biggestFallers?: MovementRow[];
};

type ActivityFixture = {
  homeTeam?: string;
  awayTeam?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  kickoffAt?: string;
  status?: string;
};

type WeeklyLeaderboardRow = {
  rank: number;
  name: string;
  points: number;
};

type WeeklyWinner = {
  name: string;
  points: number;
};

type MovementRow = {
  name: string;
  movement: number;
};

type LeagueActivityFeedProps = {
  notifications: NotificationRow[];
  currentUserId: string;
  canModerate?: boolean;
};

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMovement(movement: number) {
  if (movement > 0) {
    return `+${movement}`;
  }

  return String(movement);
}

function ActivityShell({
  notification,
  children,
  currentUserId,
  canModerate = false,
}: {
  notification: NotificationRow;
  children: React.ReactNode;
  currentUserId: string;
  canModerate?: boolean;
}) {
  return (
    <div className="brand-card-soft p-4 transition hover:border-emerald-400/25">
      <div className="flex items-start justify-between gap-3">
        <p className="text-lg font-black tracking-tight text-white">
          {notification.title ?? "League update"}
        </p>
        <span className="brand-pill shrink-0">
          {formatCreatedAt(notification.created_at)}
        </span>
      </div>
      {children}
      <ActivitySocial
        notification={notification}
        currentUserId={currentUserId}
        canModerate={canModerate}
      />
    </div>
  );
}

function getCommentDisplayName(comment: NotificationComment) {
  if (Array.isArray(comment.profiles)) {
    return comment.profiles[0]?.display_name ?? "Someone";
  }

  return comment.profiles?.display_name ?? "Someone";
}

function ActivitySocial({
  notification,
  currentUserId,
  canModerate,
}: {
  notification: NotificationRow;
  currentUserId: string;
  canModerate: boolean;
}) {
  const comments = notification.comments ?? [];

  return (
    <div className="mt-3 border-t border-white/10 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <EmojiReactionControls
          action={toggleNotificationReaction}
          hiddenFields={{ notification_id: notification.id }}
          reactions={notification.reactions ?? []}
          compact
          ariaLabel="React to league activity"
        />

        <details className="group min-w-0 flex-1 text-right">
          <summary className="cursor-pointer select-none text-xs font-bold text-slate-400 transition hover:text-white">
            Comments ({comments.length})
          </summary>

          <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/50 p-3 text-left">
            {comments.length === 0 ? (
              <p className="text-sm text-slate-500">No comments yet.</p>
            ) : (
              <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                {comments.map((comment) => {
                  const canDelete =
                    canModerate || comment.user_id === currentUserId;

                  return (
                    <div
                      key={comment.id}
                      className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div>
                          <p className="truncate text-xs font-black uppercase tracking-wide text-slate-500">
                            {getCommentDisplayName(comment)}
                          </p>
                          <p className="mt-1 text-slate-200">{comment.body}</p>
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <EmojiReactionControls
                          action={toggleNotificationCommentReaction}
                          hiddenFields={{ comment_id: comment.id }}
                          reactions={comment.reactions ?? []}
                          compact
                          placement="top"
                          ariaLabel={`React to ${getCommentDisplayName(
                            comment,
                          )}'s comment`}
                        />
                        {canDelete ? (
                          <form action={deleteNotificationComment}>
                            <input
                              type="hidden"
                              name="comment_id"
                              value={comment.id}
                            />
                            <button
                              type="submit"
                              className="rounded-full px-2 py-1 text-[11px] font-bold text-slate-500 transition hover:bg-red-500/10 hover:text-red-300"
                            >
                              Delete
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <ActivityCommentForm notificationId={notification.id} />
          </div>
        </details>
      </div>
    </div>
  );
}

function FixturesSelectedActivity({
  notification,
  currentUserId,
  canModerate,
}: {
  notification: NotificationRow;
  currentUserId: string;
  canModerate: boolean;
}) {
  const fixtures = notification.metadata?.fixtures ?? [];

  return (
    <ActivityShell
      notification={notification}
      currentUserId={currentUserId}
      canModerate={canModerate}
    >
      {notification.body ? (
        <p className="mt-2 text-sm text-slate-400">{notification.body}</p>
      ) : null}

      {fixtures.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {fixtures.map((fixture, index) => (
            <div
              key={`${fixture.homeTeam}-${fixture.awayTeam}-${index}`}
              className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
            >
              <TeamIdentity teamName={fixture.homeTeam ?? "TBD"} compact />
              <span className="rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
                v
              </span>
              <TeamIdentity
                teamName={fixture.awayTeam ?? "TBD"}
                align="right"
                compact
              />
            </div>
          ))}
        </div>
      ) : null}
    </ActivityShell>
  );
}

function ResultsAvailableActivity({
  notification,
  currentUserId,
  canModerate,
}: {
  notification: NotificationRow;
  currentUserId: string;
  canModerate: boolean;
}) {
  const metadata = notification.metadata ?? {};
  const fixtures = metadata.fixtures ?? [];
  const weeklyLeaderboard = metadata.weeklyLeaderboard ?? [];
  const biggestRisers = metadata.biggestRisers ?? [];
  const biggestFallers = metadata.biggestFallers ?? [];

  return (
    <ActivityShell
      notification={notification}
      currentUserId={currentUserId}
      canModerate={canModerate}
    >
      {notification.body ? (
        <p className="mt-2 text-sm text-slate-400">{notification.body}</p>
      ) : null}

      {fixtures.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Results
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {fixtures.map((fixture, index) => (
              <div
                key={`${fixture.homeTeam}-${fixture.awayTeam}-${index}`}
                className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{fixture.homeTeam}</span>
                  <span className="font-bold tabular-nums">
                    {fixture.homeScore ?? "-"}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span className="font-semibold">{fixture.awayTeam}</span>
                  <span className="font-bold tabular-nums">
                    {fixture.awayScore ?? "-"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {weeklyLeaderboard.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Weekly leaderboard
          </p>
          <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-slate-900/50">
            {weeklyLeaderboard.slice(0, 5).map((row) => (
              <div
                key={`${row.rank}-${row.name}`}
                className="grid grid-cols-[48px_1fr_auto] items-center gap-3 border-t border-white/10 px-3 py-2 text-sm first:border-t-0"
              >
                <span className="text-slate-500">#{row.rank}</span>
                <span className="font-semibold">{row.name}</span>
                <span className="font-bold tabular-nums">
                  {row.points} pts
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {biggestRisers.length > 0 || biggestFallers.length > 0 ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {biggestRisers.length > 0 ? (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                Biggest risers
              </p>
              <div className="mt-2 space-y-1">
                {biggestRisers.map((row) => (
                  <p key={row.name} className="text-sm">
                    <span className="font-semibold">{row.name}</span>{" "}
                    <span className="text-emerald-300">
                      {formatMovement(row.movement)}
                    </span>
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {biggestFallers.length > 0 ? (
            <div className="rounded-xl border border-red-400/20 bg-red-500/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-300">
                Biggest fallers
              </p>
              <div className="mt-2 space-y-1">
                {biggestFallers.map((row) => (
                  <p key={row.name} className="text-sm">
                    <span className="font-semibold">{row.name}</span>{" "}
                    <span className="text-red-300">
                      {formatMovement(row.movement)}
                    </span>
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </ActivityShell>
  );
}

function SimpleActivity({
  notification,
  currentUserId,
  canModerate,
}: {
  notification: NotificationRow;
  currentUserId: string;
  canModerate: boolean;
}) {
  return (
    <ActivityShell
      notification={notification}
      currentUserId={currentUserId}
      canModerate={canModerate}
    >
      {notification.body ? (
        <p className="mt-2 text-sm text-slate-400">{notification.body}</p>
      ) : null}
    </ActivityShell>
  );
}

export default function LeagueActivityFeed({
  notifications,
  currentUserId,
  canModerate = false,
}: LeagueActivityFeedProps) {
  return (
    <section className="brand-card mt-8 p-4 sm:p-5">
      <div className="brand-section-header">
        <p className="brand-eyebrow">League room</p>
        <h2 className="text-2xl font-black tracking-tight">Activity</h2>
        <p className="brand-subtitle">
          The latest picks, results, movers, and next-player nudges.
        </p>
      </div>

      {notifications.length === 0 ? (
        <p className="brand-card-soft p-4 text-sm text-slate-400">
          No league activity yet. Picks, results, and leaderboard moments will
          land here once the season starts moving.
        </p>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => {
            if (notification.type === "fixtures_selected") {
              return (
                <FixturesSelectedActivity
                  key={notification.id}
                  notification={notification}
                  currentUserId={currentUserId}
                  canModerate={canModerate}
                />
              );
            }

            if (notification.type === "results_available") {
              return (
                <ResultsAvailableActivity
                  key={notification.id}
                  notification={notification}
                  currentUserId={currentUserId}
                  canModerate={canModerate}
                />
              );
            }

            return (
              <SimpleActivity
                key={notification.id}
                notification={notification}
                currentUserId={currentUserId}
                canModerate={canModerate}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
