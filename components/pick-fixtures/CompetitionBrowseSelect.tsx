"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type CompetitionOption = {
  external_competition_code: string;
  name: string;
};

type CompetitionBrowseSelectProps = {
  gameweekId: string;
  selectedCompetitionCode: string;
  options: CompetitionOption[];
  isEditing: boolean;
};

export default function CompetitionBrowseSelect({
  gameweekId,
  selectedCompetitionCode,
  options,
  isEditing,
}: CompetitionBrowseSelectProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingCompetitionCode, setPendingCompetitionCode] = useState<
    string | null
  >(null);
  const activePendingCompetitionCode =
    pendingCompetitionCode && pendingCompetitionCode !== selectedCompetitionCode
      ? pendingCompetitionCode
      : null;
  const displayedCompetitionCode =
    activePendingCompetitionCode ?? selectedCompetitionCode;
  const displayedCompetition = options.find(
    (option) => option.external_competition_code === displayedCompetitionCode,
  );
  const isNavigating = isPending || activePendingCompetitionCode !== null;

  return (
    <label className="mt-4 block min-w-0 rounded-xl border border-white/10 bg-slate-950/35 p-3">
      <span className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-300">
        <span>Browse competition</span>
        {isNavigating ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300">
            <span
              className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-300/30 border-t-emerald-200"
              aria-hidden="true"
            />
            Loading
          </span>
        ) : null}
      </span>
      <select
        value={displayedCompetitionCode}
        disabled={isNavigating}
        aria-busy={isNavigating}
        onChange={(event) => {
          const destinationCode = event.target.value;
          setPendingCompetitionCode(destinationCode);
          const params = new URLSearchParams({
            gameweek: gameweekId,
            competition: destinationCode,
          });

          if (isEditing) {
            params.set("edit", "1");
          }

          startTransition(() => {
            router.push(`/pick-fixtures?${params.toString()}`);
          });
        }}
        className="brand-input mt-2 disabled:cursor-wait disabled:opacity-70"
      >
        {options.map((competition) => (
          <option
            key={competition.external_competition_code}
            value={competition.external_competition_code}
          >
            {competition.name} ({competition.external_competition_code})
          </option>
        ))}
      </select>
      {isNavigating ? (
        <span className="mt-2 block text-xs font-semibold text-emerald-300">
          Loading {displayedCompetition?.name ?? "competition"} fixtures...
        </span>
      ) : (
        <span className="mt-2 block text-xs text-slate-500">
          Changing competition keeps fixture editing open. Unsaved checkbox
          selections are not kept when switching.
        </span>
      )}
    </label>
  );
}
