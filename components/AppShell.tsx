import Link from "next/link";
import type { ReactNode } from "react";

type AppShellProps = {
  children: ReactNode;
  isAdmin?: boolean;
};

const baseNavItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/leaderboard", label: "Leaderboard" },
];

const adminNavItem = { href: "/admin", label: "Admin" };

export default function AppShell({ children, isAdmin = false }: AppShellProps) {
  const navItems = isAdmin ? [...baseNavItems, adminNavItem] : baseNavItems;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 pb-24 pt-6">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-emerald-400">
              Football Predictor
            </p>
            <p className="text-xs text-slate-500">Private league</p>
          </div>

          <Link
            href="/logout"
            prefetch={false}
            className="rounded-full border border-slate-800 px-3 py-1 text-sm text-slate-300"
          >
            Sign out
          </Link>
        </header>

        <div className="flex-1">{children}</div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 border-t border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <div
          className={`mx-auto grid max-w-5xl gap-2 ${
            isAdmin ? "grid-cols-3" : "grid-cols-2"
          }`}
        >
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className="rounded-xl bg-slate-900 px-3 py-2 text-center text-sm font-medium text-slate-300"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </main>
  );
}