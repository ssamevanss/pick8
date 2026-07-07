"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  markAllUserNotificationsRead,
  markUserNotificationRead,
} from "@/utils/user-notification-actions";

export type HeaderUserNotification = {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  updated_at: string;
  notification_type?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

type NotificationBellProps = {
  notifications: HeaderUserNotification[];
  unreadCount: number;
};

type DropdownPosition = {
  top: number;
  left: number;
  width: number;
};

function formatNotificationTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getStringMetadata(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];

  return typeof value === "string" ? value : null;
}

function getNotificationHref(notification: HeaderUserNotification) {
  const metadata = notification.metadata ?? {};
  const explicitHref = getStringMetadata(metadata, "targetHref");

  if (explicitHref) {
    return explicitHref;
  }

  const activityId =
    getStringMetadata(metadata, "notificationId") ??
    (notification.target_type === "notification" ? notification.target_id : null);

  if (activityId) {
    return `/dashboard?activity=${activityId}&comments=1#activity-${activityId}`;
  }

  const fixtureId = getStringMetadata(metadata, "fixtureId");
  const gameweekId = getStringMetadata(metadata, "gameweekId");

  if (fixtureId && gameweekId) {
    return `/predictions?gameweek=${gameweekId}&fixture=${fixtureId}#fixture-${fixtureId}`;
  }

  if (fixtureId) {
    return `/predictions?fixture=${fixtureId}#fixture-${fixtureId}`;
  }

  return "/dashboard";
}

export default function NotificationBell({
  notifications,
  unreadCount: initialUnreadCount,
}: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [allReadOptimistically, setAllReadOptimistically] = useState(false);
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [dropdownPosition, setDropdownPosition] =
    useState<DropdownPosition | null>(null);
  const [isPending, startTransition] = useTransition();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const locallyReadCount = notifications.filter(
    (notification) =>
      notification.read_at === null && !readNotificationIds.has(notification.id),
  ).length;
  const visibleUnreadCount = notifications.filter(
    (notification) => notification.read_at === null,
  ).length;
  const clearedVisibleUnreadCount = visibleUnreadCount - locallyReadCount;
  const unreadCount = allReadOptimistically
    ? 0
    : Math.max(0, initialUnreadCount - clearedVisibleUnreadCount);
  const displayedNotifications = [...notifications].sort((a, b) => {
    const aUnread = a.read_at === null && !readNotificationIds.has(a.id);
    const bUnread = b.read_at === null && !readNotificationIds.has(b.id);

    if (aUnread !== bUnread) {
      return aUnread ? -1 : 1;
    }

    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  function calculateDropdownPosition() {
    const button = buttonRef.current;

    if (!button) {
      return null;
    }

    const rect = button.getBoundingClientRect();
    const viewportPadding = 12;
    const width = Math.min(352, window.innerWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(viewportPadding, rect.right - width),
      window.innerWidth - width - viewportPadding,
    );

    return {
      top: rect.bottom + 8,
      left,
      width,
    };
  }

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
        panelRef.current?.contains(target)
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

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function updatePosition() {
      setDropdownPosition(calculateDropdownPosition());
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  function handleMarkAllRead() {
    setAllReadOptimistically(true);
    setReadNotificationIds(new Set(notifications.map((item) => item.id)));
    startTransition(() => {
      void markAllUserNotificationsRead();
    });
  }

  function handleMarkOneRead(notificationId: string) {
    setReadNotificationIds((current) => {
      const next = new Set(current);
      next.add(notificationId);
      return next;
    });
    setAllReadOptimistically(false);
    startTransition(() => {
      void markUserNotificationRead(notificationId);
    });
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setDropdownPosition(calculateDropdownPosition());
          setIsOpen((current) => !current);
        }}
        className="relative grid min-h-10 min-w-10 place-items-center rounded-full border border-white/10 bg-slate-900/70 text-slate-300 transition hover:border-emerald-300/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50"
        aria-label={`Open notifications${
          unreadCount > 0 ? `, ${unreadCount} unread` : ""
        }`}
        aria-expanded={isOpen}
        title="Notifications"
      >
        <span aria-hidden="true" className="text-base leading-none">
          🔔
        </span>
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full border border-slate-950 bg-red-500 px-1 text-[10px] font-black text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen && dropdownPosition
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[80] overflow-hidden rounded-2xl border border-white/10 bg-[#07111f] shadow-2xl shadow-black/50"
              style={{
                top: dropdownPosition.top,
                left: dropdownPosition.left,
                width: dropdownPosition.width,
              }}
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div>
                  <p className="text-sm font-black text-white">
                    Notifications
                  </p>
                  <p className="text-xs text-slate-500">
                    Social activity from the league
                  </p>
                </div>
                {unreadCount > 0 ? (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    disabled={isPending}
                    className="rounded-full border border-white/10 px-2.5 py-1.5 text-xs font-bold text-slate-300 transition hover:border-emerald-300/40 hover:text-white disabled:cursor-wait disabled:opacity-60"
                  >
                    {isPending ? "Marking..." : "Mark all read"}
                  </button>
                ) : null}
              </div>

              {notifications.length === 0 ? (
                <p className="px-4 py-5 text-sm text-slate-400">
                  No new league activity.
                </p>
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  {displayedNotifications.map((notification) => {
                    const isUnread =
                      notification.read_at === null &&
                      !readNotificationIds.has(notification.id);
                    const href = getNotificationHref(notification);

                    return (
                      <div
                        key={notification.id}
                        className={`border-b border-white/10 last:border-b-0 ${
                          isUnread ? "bg-emerald-300/5" : "bg-transparent opacity-70"
                        }`}
                      >
                        <div className="flex items-start gap-2 px-4 py-3">
                          <Link
                            href={href}
                            onClick={() => {
                              handleMarkOneRead(notification.id);
                              setIsOpen(false);
                            }}
                            className="flex min-w-0 flex-1 items-start gap-2 rounded-xl transition hover:text-white"
                          >
                            <span
                              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                                isUnread ? "bg-red-400" : "bg-slate-700"
                              }`}
                              aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-black text-white">
                                {notification.title}
                              </span>
                              <span className="mt-1 block text-sm leading-snug text-slate-300">
                                {notification.body}
                              </span>
                              <span className="mt-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                                {formatNotificationTime(notification.updated_at)}
                              </span>
                            </span>
                          </Link>

                          {isUnread ? (
                            <button
                              type="button"
                              onClick={() => handleMarkOneRead(notification.id)}
                              disabled={isPending}
                              className="rounded-full border border-white/10 px-2 py-1 text-[11px] font-bold text-slate-400 transition hover:border-emerald-300/40 hover:text-white disabled:cursor-wait disabled:opacity-60"
                            >
                              Clear
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
