"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { ReactNode } from "react";
import BrandMark from "@/components/brand/BrandMark";
import NotificationBell, {
  type HeaderUserNotification,
} from "@/components/notifications/NotificationBell";

type AppShellProps = {
  children: ReactNode;
  isAdmin?: boolean;
  canPickFixtures?: boolean;
  notifications?: HeaderUserNotification[];
};

const baseNavItems = [
  { href: "/dashboard", label: "Home", mobileLabel: "Home" },
  { href: "/predictions", label: "Predictions", mobileLabel: "Preds" },
  { href: "/leaderboard", label: "Leaderboard", mobileLabel: "Table" },
];

const pickFixturesNavItem = {
  href: "/pick-fixtures",
  label: "Pick Fixtures",
  mobileLabel: "Pick",
};
const adminNavItem = { href: "/admin", label: "Admin", mobileLabel: "Admin" };

function isCurrentRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({
  children,
  isAdmin = false,
  canPickFixtures = false,
  notifications = [],
}: AppShellProps) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const navItems = [
    ...baseNavItems,
    ...(canPickFixtures ? [pickFixturesNavItem] : []),
    ...(isAdmin ? [adminNavItem] : []),
  ];

  useEffect(() => {
    if (!pendingHref) {
      return;
    }

    const timeout = window.setTimeout(() => setPendingHref(null), 6000);

    return () => window.clearTimeout(timeout);
  }, [pendingHref]);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (mobileMenuRef.current?.contains(target)) {
        return;
      }

      setIsMobileMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMobileMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileMenuOpen]);

  function handleNavigate(
    event: MouseEvent<HTMLAnchorElement>,
    href: string,
  ) {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0 ||
      isCurrentRoute(pathname, href)
    ) {
      return;
    }

    setPendingHref(href);
  }

  const activePendingHref =
    pendingHref && !isCurrentRoute(pathname, pendingHref) ? pendingHref : null;

  return (
    <main className="app-surface min-h-dvh text-white">
      <div
        aria-hidden="true"
        className={`fixed inset-x-0 top-0 z-50 h-1 origin-left bg-emerald-400 transition-all duration-500 ${
          activePendingHref
            ? "scale-x-100 opacity-100"
            : "scale-x-0 opacity-0"
        }`}
      />
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-4 sm:pb-28 sm:pt-6">
        <header className="relative mb-6 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0b1627]/80 px-3 py-3 shadow-xl shadow-black/20 backdrop-blur sm:gap-4 sm:px-4">
          <div className="min-w-0">
            <BrandMark />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <NotificationBell notifications={notifications} />

            <Link
              href="/rules"
              prefetch={false}
              onClick={(event) => handleNavigate(event, "/rules")}
              className={`hidden min-h-10 rounded-full border px-3 py-2 text-sm font-semibold transition sm:inline-flex ${
                isCurrentRoute(pathname, "/rules")
                  ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-200"
                  : activePendingHref === "/rules"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-white/10 bg-slate-900/70 text-slate-300 hover:text-white active:bg-slate-800"
              }`}
            >
              {activePendingHref === "/rules" ? "Loading..." : "Rules"}
            </Link>

            <Link
              href="/settings"
              prefetch={false}
              onClick={(event) => handleNavigate(event, "/settings")}
              className={`hidden min-h-10 rounded-full border px-3 py-2 text-sm font-semibold transition sm:inline-flex ${
                isCurrentRoute(pathname, "/settings")
                  ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-200"
                  : activePendingHref === "/settings"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-white/10 bg-slate-900/70 text-slate-300 hover:text-white active:bg-slate-800"
              }`}
            >
              {activePendingHref === "/settings" ? "Loading..." : "Settings"}
            </Link>

            <Link
              href="/logout"
              prefetch={false}
              onClick={(event) => handleNavigate(event, "/logout")}
              className={`hidden min-h-10 rounded-full border px-3 py-2 text-sm font-semibold transition sm:inline-flex ${
                activePendingHref === "/logout"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-white/10 bg-slate-900/70 text-slate-300 hover:text-white active:bg-slate-800"
              }`}
            >
              {activePendingHref === "/logout" ? "Signing out..." : "Sign out"}
            </Link>

            <div ref={mobileMenuRef} className="relative sm:hidden">
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen((open) => !open)}
                className="grid min-h-10 min-w-10 place-items-center rounded-full border border-white/10 bg-slate-900/70 text-lg font-black text-slate-200 transition hover:text-white"
                aria-label="Open account menu"
                aria-expanded={isMobileMenuOpen}
              >
                ⋯
              </button>

              {isMobileMenuOpen ? (
                <div className="absolute right-0 top-full z-[70] mt-2 w-44 overflow-hidden rounded-2xl border border-white/10 bg-[#07111f] p-2 shadow-2xl shadow-black/50">
                  {[
                    { href: "/rules", label: "Rules" },
                    { href: "/settings", label: "Settings" },
                    { href: "/logout", label: "Sign out" },
                  ].map((item) => {
                    const isActive = isCurrentRoute(pathname, item.href);
                    const isPending = activePendingHref === item.href;

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        prefetch={false}
                        onClick={(event) => {
                          handleNavigate(event, item.href);
                          setIsMobileMenuOpen(false);
                        }}
                        className={`block rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                          isActive
                            ? "bg-emerald-400 text-slate-950"
                            : isPending
                              ? "bg-emerald-500/10 text-emerald-300"
                              : "text-slate-200 hover:bg-slate-900 hover:text-white"
                        }`}
                      >
                        {isPending
                          ? item.href === "/logout"
                            ? "Signing out..."
                            : "Loading..."
                          : item.label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div
          className={`flex-1 transition-opacity duration-200 ${
            activePendingHref ? "opacity-80" : "opacity-100"
          }`}
          aria-busy={Boolean(activePendingHref)}
        >
          {children}
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/95 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 shadow-2xl shadow-black/40 backdrop-blur-xl sm:px-4 sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pt-3">
        <div
          className="mx-auto grid max-w-5xl gap-1 sm:gap-2"
          style={{
            gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))`,
          }}
        >
          {navItems.map((item) => (
            (() => {
              const isActive = isCurrentRoute(pathname, item.href);
              const isPending = activePendingHref === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  aria-current={isActive ? "page" : undefined}
                  onClick={(event) => handleNavigate(event, item.href)}
                  className={`flex min-h-11 items-center justify-center rounded-lg px-1.5 py-2 text-center text-xs font-medium leading-tight transition active:scale-[0.98] sm:rounded-xl sm:px-3 sm:text-sm ${
                    isActive
                      ? "bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-950/30"
                      : isPending
                        ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                        : "bg-slate-900/80 text-slate-300 hover:text-white active:bg-slate-800"
                  }`}
                >
                  <span className="sm:hidden">
                    {isPending ? "Loading" : item.mobileLabel}
                  </span>
                  <span className="hidden sm:inline">
                    {isPending ? "Loading..." : item.label}
                  </span>
                </Link>
              );
            })()
          ))}
        </div>
      </nav>
    </main>
  );
}
