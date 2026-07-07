"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { markAllUserNotificationsRead } from "@/utils/user-notification-actions";

export type HeaderUserNotification = {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  updated_at: string;
};

type NotificationBellProps = {
  notifications: HeaderUserNotification[];
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

export default function NotificationBell({
  notifications,
}: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [optimisticallyRead, setOptimisticallyRead] = useState(false);
  const [dropdownPosition, setDropdownPosition] =
    useState<DropdownPosition | null>(null);
  const [isPending, startTransition] = useTransition();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const unreadCount = optimisticallyRead
    ? 0
    : notifications.filter((notification) => !notification.read_at).length;

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
    setOptimisticallyRead(true);
    startTransition(() => {
      void markAllUserNotificationsRead();
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
          <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full border border-slate-950 bg-emerald-300 px-1 text-[10px] font-black text-slate-950">
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
                  No social notifications yet.
                </p>
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  {notifications.map((notification) => {
                    const isUnread =
                      !optimisticallyRead && notification.read_at === null;

                    return (
                      <div
                        key={notification.id}
                        className={`border-b border-white/10 px-4 py-3 last:border-b-0 ${
                          isUnread ? "bg-emerald-300/5" : "bg-transparent"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                              isUnread ? "bg-emerald-300" : "bg-slate-700"
                            }`}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-black text-white">
                              {notification.title}
                            </p>
                            <p className="mt-1 text-sm leading-snug text-slate-300">
                              {notification.body}
                            </p>
                            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                              {formatNotificationTime(notification.updated_at)}
                            </p>
                          </div>
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
