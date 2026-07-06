"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";
import type { ReactNode } from "react";
import BrandMark from "@/components/brand/BrandMark";

type AppShellProps = {
  children: ReactNode;
  isAdmin?: boolean;
  canPickFixtures?: boolean;
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
}: AppShellProps) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
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
    <main className="app-surface min-h-screen text-white">
      <div
        aria-hidden="true"
        className={`fixed inset-x-0 top-0 z-50 h-1 origin-left bg-emerald-400 transition-all duration-500 ${
          activePendingHref
            ? "scale-x-100 opacity-100"
            : "scale-x-0 opacity-0"
        }`}
      />
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-24 pt-4 sm:pt-6">
        <header className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#0b1627]/80 px-3 py-3 shadow-xl shadow-black/20 backdrop-blur sm:px-4">
          <BrandMark />

          <Link
            href="/logout"
            prefetch={false}
            onClick={(event) => handleNavigate(event, "/logout")}
            className={`min-h-10 shrink-0 rounded-full border px-3 py-2 text-sm font-semibold transition ${
              activePendingHref === "/logout"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 bg-slate-900/70 text-slate-300 hover:text-white active:bg-slate-800"
            }`}
          >
            {activePendingHref === "/logout" ? "Signing out..." : "Sign out"}
          </Link>
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

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/90 px-2 py-2 shadow-2xl shadow-black/40 backdrop-blur-xl sm:px-4 sm:py-3">
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
