"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

type MatchdayOption = {
  number: number;
  label: string;
};

export default function MatchdaySelectNavigation({
  currentMatchday,
  matchdays,
  className = "",
}: {
  currentMatchday: number;
  matchdays: MatchdayOption[];
  className?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const validNumbers = new Set(matchdays.map((matchday) => matchday.number));

  function navigate(value: string) {
    if (!/^\d+$/.test(value)) return;
    const matchday = Number(value);
    if (!Number.isSafeInteger(matchday) || !validNumbers.has(matchday)) return;

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("matchday", String(matchday));
    startTransition(() => router.push(`${pathname}?${nextParams.toString()}`));
  }

  return (
    <div className={className}>
      <label className="block text-sm text-slate-300">
        Matchday
        <select
          className="brand-input min-w-44"
          value={currentMatchday}
          disabled={isPending}
          onChange={(event) => navigate(event.target.value)}
        >
          {matchdays.map((matchday) => (
            <option key={matchday.number} value={matchday.number}>
              {matchday.label}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1 min-h-4 text-xs text-slate-400" aria-live="polite">
        {isPending ? "Loading matchday…" : null}
      </p>
    </div>
  );
}
