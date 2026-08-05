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
  { href: "/rules", label: "Rules", mobileLabel: "Rules" },
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
    <main className="app-surface min-h-dvh text-white">
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pb-28 pt-4 sm:pb-12 sm:pt-6">
        <header className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0b1627]/80 px-3 py-3 shadow-xl shadow-black/20 backdrop-blur sm:px-4">
          <BrandMark />

          <nav className="hidden items-center gap-1 sm:flex" aria-label="Account">
            {isAdmin ? <NavLink href="/admin" label="Admin" /> : null}
            <NavLink href="/settings" label="Settings" />
            <NavLink href="/logout" label="Sign out" />
          </nav>

          <Link
            href="/logout"
            prefetch={false}
            className="brand-button-secondary sm:hidden"
          >
            Sign out
          </Link>
        </header>

        <div className="min-w-0 flex-1">{children}</div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/95 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl sm:static sm:mx-auto sm:mt-[-5.5rem] sm:max-w-5xl sm:border-0 sm:bg-transparent sm:px-4 sm:pb-3"
        aria-label="Primary"
      >
        <div
          className="mx-auto grid max-w-5xl gap-1 sm:gap-2"
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
    </main>
  );
}
