"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import BrandMark from "@/components/brand/BrandMark";

type AppShellProps = {
  children: ReactNode;
  isAdmin: boolean;
};

const primaryItems = [
  { href: "/dashboard", label: "Dashboard", mobileLabel: "Home" },
  { href: "/my-picks", label: "My Picks", mobileLabel: "Picks" },
  { href: "/tables", label: "Tables", mobileLabel: "Tables" },
];

function isCurrentRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  href,
  label,
  mobileLabel,
  className = "",
}: {
  href: string;
  label: string;
  mobileLabel?: string;
  className?: string;
}) {
  const pathname = usePathname();
  const active = isCurrentRoute(pathname, href);

  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={`${className} rounded-xl px-3 py-2 text-sm font-bold transition ${
        active
          ? "bg-emerald-400 text-slate-950"
          : "text-slate-300 hover:bg-slate-900 hover:text-white"
      }`}
    >
      {mobileLabel ? (
        <>
          <span className="sm:hidden">{mobileLabel}</span>
          <span className="hidden sm:inline">{label}</span>
        </>
      ) : (
        label
      )}
    </Link>
  );
}

export default function AppShell({ children, isAdmin }: AppShellProps) {
  const items = isAdmin
    ? [...primaryItems, { href: "/admin", label: "Admin", mobileLabel: "Admin" }]
    : primaryItems;

  return (
    <div className="app-surface flex h-dvh min-h-dvh flex-col overflow-y-auto overscroll-y-contain pb-[var(--mobile-nav-clearance)] scroll-pb-[var(--mobile-nav-clearance)] text-white sm:h-auto sm:overflow-visible sm:pb-0 sm:scroll-pb-0">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pt-4 sm:pb-12 sm:pt-6">
        <header className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0b1627]/80 px-3 py-3 shadow-xl shadow-black/20 backdrop-blur sm:px-4">
          <BrandMark />

          <nav className="hidden items-center gap-1 sm:flex" aria-label="Account">
            <NavLink href="/rules" label="Rules" />
            <NavLink href="/settings" label="Settings" />
            <NavLink href="/logout" label="Sign out" />
          </nav>

          <details className="group relative sm:hidden">
            <summary className="brand-button-secondary cursor-pointer list-none [&::-webkit-details-marker]:hidden">Menu</summary>
            <nav className="absolute right-0 top-[calc(100%+0.5rem)] z-50 grid min-w-40 gap-1 rounded-xl border border-white/15 bg-[#07101f] p-2 shadow-2xl shadow-black/50" aria-label="Account menu">
              <NavLink href="/rules" label="Rules" />
              <NavLink href="/settings" label="Settings" />
              <NavLink href="/logout" label="Sign out" />
            </nav>
          </details>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-50 w-full min-h-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom))] border-t border-white/15 bg-[#07101f] px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_28px_rgba(0,0,0,0.45)] sm:static sm:min-h-0 sm:border-0 sm:bg-transparent sm:px-4 sm:pb-3 sm:shadow-none"
        aria-label="Primary"
      >
        <div
          className="mx-auto grid w-full max-w-6xl gap-1 sm:gap-2"
          style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        >
          {items.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              mobileLabel={item.mobileLabel}
              className="text-center"
            />
          ))}
        </div>
      </nav>
    </div>
  );
}
