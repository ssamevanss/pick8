"use client";

import { useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import { addNotificationComment } from "@/utils/social-actions";

type ActivityCommentFormProps = {
  notificationId: string;
};

export default function ActivityCommentForm({
  notificationId,
}: ActivityCommentFormProps) {
  const { showToast } = useToast();
  const [body, setBody] = useState("");
  const [isPosting, setIsPosting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedBody = body.trim();

    if (!trimmedBody) {
      return;
    }

    const formData = new FormData();
    formData.set("notification_id", notificationId);
    formData.set("body", trimmedBody);
    setIsPosting(true);

    try {
      await addNotificationComment(formData);
      setBody("");
    } catch {
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
  );
}
