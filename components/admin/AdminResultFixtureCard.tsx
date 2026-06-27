import type { Fixture } from "@/components/predictions/types";

type AdminResultFixtureCardProps = {
  fixture: Fixture;
};

function formatKickoff(kickoffAt: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(kickoffAt));
}

export default function AdminResultFixtureCard({
  fixture,
}: AdminResultFixtureCardProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
      <input type="hidden" name="fixture_id" value={fixture.id} />

      <p className="text-xs text-slate-500">
        {formatKickoff(fixture.kickoff_at)} · {fixture.competition} ·{" "}
        {fixture.status}
      </p>

      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex-1">
          <p className="font-medium">{fixture.home_team}</p>
          <p className="font-medium">{fixture.away_team}</p>
        </div>

        <div className="flex items-center gap-2">
          <input
            name={`home_score_${fixture.id}`}
            type="number"
            inputMode="numeric"
            min="0"
            defaultValue={fixture.home_score ?? ""}
            className="h-10 w-12 rounded-lg bg-slate-800 text-center text-lg font-bold outline-none"
            aria-label={`${fixture.home_team} actual score`}
          />
          <span className="text-slate-500">-</span>
          <input
            name={`away_score_${fixture.id}`}
            type="number"
            inputMode="numeric"
            min="0"
            defaultValue={fixture.away_score ?? ""}
            className="h-10 w-12 rounded-lg bg-slate-800 text-center text-lg font-bold outline-none"
            aria-label={`${fixture.away_team} actual score`}
          />
        </div>
      </div>
    </div>
  );
}