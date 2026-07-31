"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type AdminTab = "overview" | "users" | "leagues" | "seasons" | "maintenance";

type AdminTabsProps = {
  selectedTab: AdminTab;
  selectedGameweekId: string | null;
};

const tabs: { id: AdminTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "leagues", label: "Leagues" },
  { id: "seasons", label: "Seasons" },
  { id: "maintenance", label: "Maintenance" },
];

function getTabHref(tab: AdminTab, selectedGameweekId: string | null) {
  if (tab === "maintenance" && selectedGameweekId) {
    return `/admin?tab=${tab}&gameweek=${selectedGameweekId}`;
  }

  return `/admin?tab=${tab}`;
}

export default function AdminTabs({
  selectedTab,
  selectedGameweekId,
}: AdminTabsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleTabClick(tab: AdminTab) {
    const href = getTabHref(tab, selectedGameweekId);

    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <div className="mt-6">
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/70 p-2">
        <div className="flex min-w-max gap-2">
          {tabs.map((tab) => {
            const isSelected = tab.id === selectedTab;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabClick(tab.id)}
                disabled={isPending}
                className={`whitespace-nowrap rounded-xl px-4 py-2 text-center text-sm font-semibold transition ${
                  isSelected
                    ? "bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-950/30"
                    : "bg-slate-900/70 text-slate-300 hover:text-white"
                } ${isPending ? "cursor-wait opacity-80" : ""}`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {isPending ? (
        <>
          <div className="mt-3 overflow-hidden rounded-full bg-slate-900/80">
            <div className="h-1 w-1/3 animate-pulse rounded-full bg-emerald-400" />
          </div>

          <p className="mt-2 text-xs text-slate-500">
            Loading admin section...
          </p>
        </>
      ) : null}
    </div>
  );
}
