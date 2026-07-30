"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

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

  return (
    <label className="mt-4 block min-w-0">
      <span className="text-sm font-semibold text-slate-300">
        Browse competition
      </span>
      <select
        value={selectedCompetitionCode}
        disabled={isPending}
        aria-busy={isPending}
        onChange={(event) => {
          const params = new URLSearchParams({
            gameweek: gameweekId,
            competition: event.target.value,
          });

          if (isEditing) {
            params.set("edit", "1");
          }

          startTransition(() => {
            router.push(`/pick-fixtures?${params.toString()}`);
          });
        }}
        className="brand-input mt-1"
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
      {isPending ? (
        <span className="mt-1 block text-xs font-semibold text-emerald-300">
          Loading fixtures...
        </span>
      ) : (
        <span className="mt-1 block text-xs text-slate-500">
          Changing competition keeps you in fixture-editing mode.
        </span>
      )}
    </label>
  );
}
