"use client";

import { useMemo, useState } from "react";
import EmojiReactionControls from "@/components/social/EmojiReactionControls";
import type { ReactionSummary } from "@/components/predictions/types";
import { useToast } from "@/components/toast/ToastProvider";
import {
  addNotificationComment,
  deleteNotificationComment,
  toggleNotificationCommentReaction,
} from "@/utils/social-actions";

type CommentProfile =
  | {
      display_name: string;
    }
  | {
      display_name: string;
    }[]
  | null;

export type ActivityComment = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  reactions?: ReactionSummary[];
  profiles: CommentProfile;
  pending?: boolean;
};

type ActivityCommentsSectionProps = {
  notificationId: string;
  comments: ActivityComment[];
  currentUserId: string;
  canModerate: boolean;
};

function getCommentDisplayName(comment: ActivityComment) {
  if (Array.isArray(comment.profiles)) {
    return comment.profiles[0]?.display_name?.trim() || "Player";
  }

  return comment.profiles?.display_name?.trim() || "Player";
}

function makeProfile(displayName: string): CommentProfile {
  return { display_name: displayName };
}

export default function ActivityCommentsSection({
  notificationId,
  comments,
  currentUserId,
  canModerate,
}: ActivityCommentsSectionProps) {
  const { showToast } = useToast();
  const [body, setBody] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [localComments, setLocalComments] = useState<ActivityComment[]>([]);

  const displayedComments = useMemo(() => {
    const merged = new Map<string, ActivityComment>();

    for (const comment of comments) {
      merged.set(comment.id, comment);
    }

    for (const comment of localComments) {
      if (!merged.has(comment.id)) {
        merged.set(comment.id, comment);
      }
    }

    return [...merged.values()].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [comments, localComments]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedBody = body.trim();

    if (!trimmedBody) {
      return;
    }

    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticComment: ActivityComment = {
      id: optimisticId,
      user_id: currentUserId,
      body: trimmedBody,
      created_at: new Date().toISOString(),
      reactions: [],
      profiles: makeProfile("You"),
      pending: true,
    };
    const formData = new FormData();
    formData.set("notification_id", notificationId);
    formData.set("body", trimmedBody);

    setBody("");
    setIsPosting(true);
    setLocalComments((current) => [...current, optimisticComment]);

    try {
      const insertedComment = await addNotificationComment(formData);

      if (!insertedComment) {
        throw new Error("Comment not saved");
      }

      setLocalComments((current) =>
        current.map((comment) =>
          comment.id === optimisticId
            ? {
                id: insertedComment.id,
                user_id: insertedComment.user_id,
                body: insertedComment.body,
                created_at: insertedComment.created_at,
                reactions: [],
                profiles: makeProfile(insertedComment.display_name),
                pending: false,
              }
            : comment,
        ),
      );
    } catch {
      setLocalComments((current) =>
        current.filter((comment) => comment.id !== optimisticId),
      );
      setBody(trimmedBody);
      showToast({
        title: "Comment not posted",
        description: "Please try again.",
        tone: "error",
      });
    } finally {
      setIsPosting(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/50 p-3 text-left">
      {displayedComments.length === 0 ? (
        <p className="text-sm text-slate-500">No comments yet.</p>
      ) : (
        <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
          {displayedComments.map((comment) => {
            const canDelete =
              !comment.pending && (canModerate || comment.user_id === currentUserId);

            return (
              <div
                key={comment.id}
                className={`rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm ${
                  comment.pending ? "opacity-80" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-black uppercase tracking-wide text-slate-500">
                      {getCommentDisplayName(comment)}
                      {comment.pending ? (
                        <span className="ml-2 text-emerald-300">Posting...</span>
                      ) : null}
                    </p>
                    <p className="mt-1 break-words text-slate-200">
                      {comment.body}
                    </p>
                  </div>

                  {canDelete ? (
                    <details className="relative shrink-0">
                      <summary
                        className="grid h-7 w-7 cursor-pointer list-none place-items-center rounded-full text-slate-500 transition hover:bg-slate-800 hover:text-white [&::-webkit-details-marker]:hidden"
                        aria-label="Comment actions"
                        title="Comment actions"
                      >
                        ⋯
                      </summary>
                      <div className="absolute right-0 top-full z-20 mt-1 w-28 rounded-xl border border-white/10 bg-[#07111f] p-1 shadow-xl shadow-black/40">
                        <form
                          action={deleteNotificationComment}
                          onSubmit={(event) => {
                            if (!window.confirm("Delete this comment?")) {
                              event.preventDefault();
                            }
                          }}
                        >
                          <input
                            type="hidden"
                            name="comment_id"
                            value={comment.id}
                          />
                          <button
                            type="submit"
                            className="block w-full rounded-lg px-2 py-1.5 text-left text-xs font-bold text-red-300 transition hover:bg-red-500/10"
                          >
                            Delete
                          </button>
                        </form>
                      </div>
                    </details>
                  ) : null}
                </div>

                <div className="mt-1.5 flex items-center justify-between gap-2">
                  {comment.pending ? (
                    <span className="text-[11px] font-semibold text-slate-500">
                      Saving to the league room...
                    </span>
                  ) : (
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
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="mt-3 flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/70 p-1.5 focus-within:border-emerald-300/50"
      >
        <input
          name="body"
          type="text"
          maxLength={240}
          value={body}
          disabled={isPosting}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add a comment..."
          className="min-w-0 flex-1 bg-transparent px-2 text-sm text-white outline-none placeholder:text-slate-600 disabled:opacity-70"
        />
        <button
          type="submit"
          disabled={isPosting || body.trim().length === 0}
          className="inline-flex min-h-8 shrink-0 items-center rounded-full bg-emerald-300 px-3 text-xs font-black text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {isPosting ? "Posting..." : "Post"}
        </button>
      </form>
    </div>
  );
}
