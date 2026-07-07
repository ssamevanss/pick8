"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactionSummary } from "@/components/predictions/types";
import { useOptionalToast } from "@/components/toast/ToastProvider";

const EMOJIS = ["😂", "🔥", "👀", "😭", "🤝"];

type EmojiReactionControlsProps = {
  action: (formData: FormData) => void | Promise<void>;
  hiddenFields: Record<string, string>;
  reactions: ReactionSummary[];
  compact?: boolean;
  placement?: "auto" | "top" | "bottom";
  ariaLabel: string;
};

type PopoverPosition = {
  top: number;
  left: number;
  width: number;
  side: "top" | "bottom";
  arrowLeft: number;
};

function applyOptimisticReaction({
  reactions,
  emoji,
}: {
  reactions: ReactionSummary[];
  emoji: string;
}) {
  const next = reactions.map((reaction) => ({ ...reaction }));
  const currentReaction = next.find(
    (reaction) => reaction.reactedByCurrentUser,
  );
  const selectedReaction = next.find((reaction) => reaction.emoji === emoji);

  if (currentReaction?.emoji === emoji) {
    currentReaction.count = Math.max(0, currentReaction.count - 1);
    currentReaction.reactedByCurrentUser = false;
  } else {
    if (currentReaction) {
      currentReaction.count = Math.max(0, currentReaction.count - 1);
      currentReaction.reactedByCurrentUser = false;
    }

    if (selectedReaction) {
      selectedReaction.count += 1;
      selectedReaction.reactedByCurrentUser = true;
    } else {
      next.push({
        emoji,
        count: 1,
        reactedByCurrentUser: true,
      });
    }
  }

  return next.filter((reaction) => reaction.count > 0);
}

function getReactionSignature(reactions: ReactionSummary[]) {
  return reactions
    .filter((reaction) => reaction.count > 0)
    .map((reaction) => ({
      emoji: reaction.emoji,
      count: reaction.count,
      reactedByCurrentUser: reaction.reactedByCurrentUser,
    }))
    .sort((a, b) => a.emoji.localeCompare(b.emoji))
    .map(
      (reaction) =>
        `${reaction.emoji}:${reaction.count}:${
          reaction.reactedByCurrentUser ? "1" : "0"
        }`,
    )
    .join("|");
}

export default function EmojiReactionControls({
  action,
  hiddenFields,
  reactions,
  compact = false,
  placement = "auto",
  ariaLabel,
}: EmojiReactionControlsProps) {
  const toast = useOptionalToast();
  const [isPending, setIsPending] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] =
    useState<PopoverPosition | null>(null);
  const [optimisticReactions, setOptimisticReactions] = useState<
    ReactionSummary[] | null
  >(null);
  const [optimisticSignature, setOptimisticSignature] = useState<string | null>(
    null,
  );
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const propsSignature = getReactionSignature(reactions);
  const displayedReactions =
    optimisticReactions && optimisticSignature !== propsSignature
      ? optimisticReactions
      : reactions;
  const reactionsByEmoji = new Map(
    displayedReactions.map((reaction) => [reaction.emoji, reaction]),
  );
  const activeReactions = displayedReactions.filter(
    (reaction) => reaction.count > 0,
  );
  const currentUserReaction = activeReactions.find(
    (reaction) => reaction.reactedByCurrentUser,
  );
  const visibleReactionLimit = compact ? 2 : 4;
  const visibleReactions = currentUserReaction
    ? [
        ...activeReactions.filter(
          (reaction) => reaction.emoji !== currentUserReaction.emoji,
        ).slice(0, visibleReactionLimit - 1),
        currentUserReaction,
      ].slice(0, visibleReactionLimit)
    : activeReactions.slice(0, visibleReactionLimit);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (
        wrapperRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }

      setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const calculatePopoverPosition = useCallback((): PopoverPosition | null => {
    const trigger = triggerRef.current;

    if (!trigger || typeof window === "undefined") {
      return null;
    }

    const rect = trigger.getBoundingClientRect();
    const popoverWidth = compact ? 192 : 224;
    const renderedHeight = popoverRef.current?.offsetHeight;
    const popoverHeight = renderedHeight && renderedHeight > 0 ? renderedHeight : 44;
    const viewportPadding = 8;
    const gap = 4;
    const triggerCenter = rect.left + rect.width / 2;
    const canOpenAbove = rect.top >= popoverHeight + gap + viewportPadding;
    const shouldOpenBelow =
      placement === "bottom" || (!canOpenAbove && placement !== "top");
    const side: "top" | "bottom" = shouldOpenBelow ? "bottom" : "top";
    const unclampedLeft = triggerCenter - popoverWidth / 2;
    const maxLeft = Math.max(
      viewportPadding,
      window.innerWidth - popoverWidth - viewportPadding,
    );
    const left = Math.min(Math.max(viewportPadding, unclampedLeft), maxLeft);
    const top =
      side === "top"
        ? Math.max(viewportPadding, rect.top - popoverHeight - gap)
        : Math.min(
            window.innerHeight - popoverHeight - viewportPadding,
            rect.bottom + gap,
          );
    const arrowLeft = Math.min(
      Math.max(14, triggerCenter - left),
      popoverWidth - 14,
    );

    return {
      top,
      left,
      width: popoverWidth,
      side,
      arrowLeft,
    };
  }, [compact, placement]);

  const updatePopoverPosition = useCallback(() => {
    setPopoverPosition(calculatePopoverPosition());
  }, [calculatePopoverPosition]);

  function togglePopover() {
    if (isOpen) {
      setIsOpen(false);
      return;
    }

    setPopoverPosition(calculatePopoverPosition());
    setIsOpen(true);
  }

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleViewportChange() {
      updatePopoverPosition();
    }

    const frame = window.requestAnimationFrame(handleViewportChange);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isOpen, updatePopoverPosition]);

  async function submitReaction(emoji: string) {
    const previousReactions = displayedReactions;
    const nextReactions = applyOptimisticReaction({
      reactions: previousReactions,
      emoji,
    });
    const formData = new FormData();

    Object.entries(hiddenFields).forEach(([name, value]) => {
      formData.set(name, value);
    });

    formData.set("emoji", emoji);
    setIsOpen(false);
    setOptimisticReactions(nextReactions);
    setOptimisticSignature(getReactionSignature(nextReactions));
    setIsPending(true);

    try {
      await action(formData);
    } catch {
      setOptimisticReactions(previousReactions);
      setOptimisticSignature(getReactionSignature(previousReactions));
      toast?.showToast({
        title: "Reaction not saved",
        description: "Please try again.",
        tone: "error",
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div
      ref={wrapperRef}
      className={`relative inline-flex items-center justify-end gap-1 overflow-visible ${
        compact ? "w-fit max-w-full" : "max-w-full flex-wrap"
      }`}
    >
      {visibleReactions.length > 0
        ? visibleReactions.map((reaction) => {
            const isOwnReaction = reaction.reactedByCurrentUser;
            const chipClassName = `inline-flex items-center gap-1 rounded-full border ${
              compact ? "h-6 px-1.5 text-[10px]" : "h-7 px-1.5 text-xs"
            } ${
              isOwnReaction
                ? "border-emerald-300/60 bg-emerald-300/15 text-white shadow-sm shadow-emerald-950/30"
                : "border-white/15 bg-slate-800/80 text-slate-200"
            }`;
            const chipLabel = isOwnReaction
              ? `You reacted with ${reaction.emoji}. ${reaction.count} total. Change or remove reaction.`
              : `${reaction.count} reaction${
                  reaction.count === 1 ? "" : "s"
                } with ${reaction.emoji}`;

            if (isOwnReaction) {
              return (
                <button
                  key={reaction.emoji}
                  ref={triggerRef}
                  type="button"
                  onClick={togglePopover}
                  disabled={isPending}
                  className={`${chipClassName} transition hover:border-emerald-200 hover:bg-emerald-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50 disabled:cursor-wait disabled:opacity-70`}
                  title={`You reacted with ${reaction.emoji}`}
                  aria-label={chipLabel}
                  aria-expanded={isOpen}
                >
                  <span aria-hidden="true">{reaction.emoji}</span>
                  <span className="tabular-nums">{reaction.count}</span>
                </button>
              );
            }

            return (
              <span
                key={reaction.emoji}
                className={chipClassName}
                title={`${reaction.count} reaction${
                  reaction.count === 1 ? "" : "s"
                } with ${reaction.emoji}`}
                aria-label={chipLabel}
              >
                <span aria-hidden="true">{reaction.emoji}</span>
                <span className="tabular-nums">{reaction.count}</span>
              </span>
            );
          })
        : null}

      {!currentUserReaction ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={togglePopover}
          disabled={isPending}
          className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-full border border-white/10 bg-slate-950/60 text-slate-400 transition hover:border-emerald-300/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50 disabled:cursor-wait disabled:opacity-60 ${
            compact ? "h-6 w-6 text-[11px]" : "h-7 px-2 text-xs font-bold"
          }`}
          aria-label={ariaLabel}
          aria-expanded={isOpen}
          title="React"
        >
          <span aria-hidden="true">☺</span>
          <span className={compact ? "sr-only" : ""}>React</span>
        </button>
      ) : null}

      {isOpen && popoverPosition
        ? createPortal(
            <div
              ref={popoverRef}
              className="fixed z-[90] box-border flex max-w-[calc(100vw-1rem)] items-center gap-0.5 rounded-xl border border-white/10 bg-slate-950/95 p-1.5 shadow-2xl shadow-black/50 ring-1 ring-emerald-300/10"
              style={{
                top: popoverPosition.top,
                left: popoverPosition.left,
                width: popoverPosition.width,
              }}
              aria-label={ariaLabel}
            >
          <span
            className={`pointer-events-none absolute h-2.5 w-2.5 rotate-45 bg-slate-950/95 ${
              popoverPosition.side === "top"
                ? "-bottom-1 border-b border-r border-white/10"
                : "-top-1 border-l border-t border-white/10"
            }`}
            style={{ left: popoverPosition.arrowLeft - 5 }}
            aria-hidden="true"
          />
          {EMOJIS.map((emoji) => {
            const reaction = reactionsByEmoji.get(emoji);
            const count = reaction?.count ?? 0;
            const reacted = Boolean(reaction?.reactedByCurrentUser);

            return (
              <button
                key={emoji}
                type="button"
                disabled={isPending}
                onClick={() => {
                  void submitReaction(emoji);
                }}
                className={`relative inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-0.5 rounded-full border px-1 text-xs font-bold transition disabled:cursor-wait disabled:opacity-60 ${
                  reacted
                    ? "border-emerald-300/60 bg-emerald-300/15 text-white shadow-sm shadow-emerald-950/30"
                    : count > 0
                      ? "border-white/15 bg-slate-800/80 text-slate-200 hover:border-emerald-300/40 hover:text-white"
                      : "border-white/10 bg-slate-950/50 text-slate-500 hover:border-white/20 hover:text-slate-200"
                }`}
                aria-pressed={reacted}
                aria-label={`${reacted ? "Remove" : "React with"} ${emoji}`}
                title={`${reacted ? "Remove" : "React with"} ${emoji}`}
              >
                <span aria-hidden="true">{emoji}</span>
                {count > 0 ? (
                  <span className="tabular-nums">{count}</span>
                ) : null}
              </button>
            );
          })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
