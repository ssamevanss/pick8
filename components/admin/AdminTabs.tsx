"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type AdminTab = "create" | "fixtures" | "results" | "users";

type AdminTabsProps = {
  selectedTab: AdminTab;
  selectedGameweekId: string | null;
};

const tabs: { id: AdminTab; label: string }[] = [
  { id: "create", label: "Season" },
  { id: "fixtures", label: "Fixtures" },
  { id: "results", label: "Results" },
  { id: "users", label: "Users" },
];

function getTabHref(tab: AdminTab, selectedGameweekId: string | null) {
  if (tab === "create" || tab === "users") {
    return `/admin?tab=${tab}`;
  }

  if (selectedGameweekId) {
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
      <div className="overflow-x-auto rounded-2xl bg-slate-900 p-2">
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
                    ? "bg-emerald-500 text-slate-950"
                    : "bg-slate-950 text-slate-300 hover:bg-slate-800"
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
          <div className="mt-3 overflow-hidden rounded-full bg-slate-900">
            <div className="h-1 w-1/3 animate-pulse rounded-full bg-emerald-500" />
          </div>

          <p className="mt-2 text-xs text-slate-500">
            Loading admin section...
          </p>
        </>
      ) : null}
    </div>
  );
}