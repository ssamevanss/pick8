"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useOptimistic, useTransition, type ReactNode } from "react";
import CompetitionLoading, { Spinner } from "@/components/tables/CompetitionLoading";
import { competitionSelectionQuery } from "@/utils/pick8-standings";

export type CompetitionSelectOption = { id: string; label: string };

type Switcher = {
  isPending: boolean;
  shownId: string;
  options: CompetitionSelectOption[];
  select: (id: string) => void;
};

const SwitcherContext = createContext<Switcher | null>(null);

function useSwitcher() {
  const value = useContext(SwitcherContext);
  if (!value) throw new Error("Competition controls must be rendered inside CompetitionSwitcher.");
  return value;
}

/**
 * Switches the `competition` query parameter. The URL is the source of truth
 * (direct links, refresh and back/forward just work); the current competition
 * is the parameter-less default, so its link never goes stale. While a switch
 * is pending the select is locked and the previous competition's table is
 * replaced by a loading state, so a stale table never sits under a new label.
 */
export function CompetitionSwitcher({
  selectedId,
  currentId,
  options,
  children,
}: {
  selectedId: string;
  currentId: string | null;
  options: CompetitionSelectOption[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [shownId, setShownId] = useOptimistic(selectedId);

  function select(id: string) {
    if (isPending || id === selectedId || !options.some((option) => option.id === id)) return;
    const query = competitionSelectionQuery(searchParams.toString(), id, currentId);
    startTransition(() => {
      setShownId(id);
      router.push(query ? `${pathname}?${query}` : pathname);
    });
  }

  return <SwitcherContext.Provider value={{ isPending, shownId, options, select }}>{children}</SwitcherContext.Provider>;
}

export function CompetitionSelect() {
  const { isPending, shownId, options, select } = useSwitcher();
  return (
    <div className="w-full sm:max-w-md">
      <label htmlFor="competition-select" className="block text-sm font-bold text-slate-300">Competition</label>
      <div className="relative">
        <select
          id="competition-select"
          className="brand-input min-h-11 w-full text-base sm:text-sm"
          value={shownId}
          disabled={isPending}
          aria-busy={isPending}
          onChange={(event) => select(event.target.value)}
        >
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        {isPending ? <span className="pointer-events-none absolute inset-y-0 right-9 flex items-center"><Spinner /></span> : null}
      </div>
    </div>
  );
}

/** The selected competition's heading and standings; replaced by the loading state while a switch is pending. */
export function CompetitionPanel({ children }: { children: ReactNode }) {
  const { isPending } = useSwitcher();
  return isPending ? <CompetitionLoading /> : <>{children}</>;
}
