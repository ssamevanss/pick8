import { addFixtureToGameweek } from "@/app/(app)/admin/actions";
import SubmitButton from "@/components/forms/SubmitButton";

type AdminAddFixtureFormProps = {
  gameweekId: string | null;
  timingWindowText?: string | null;
  defaultCompetitionName?: string | null;
};

export default function AdminAddFixtureForm({
  gameweekId,
  timingWindowText,
  defaultCompetitionName,
}: AdminAddFixtureFormProps) {
  if (!gameweekId) {
    return null;
  }

  return (
    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950 p-4">
      <h3 className="text-lg font-semibold">Add manual fixture</h3>
      <p className="mt-1 text-sm text-slate-400">
        Add another fixture to the selected gameweek. Manual fixtures are not
        changed by external refresh or result sync.
      </p>

      <form action={addFixtureToGameweek} className="mt-4 space-y-3">
        <input type="hidden" name="gameweek_id" value={gameweekId} />

        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="text-sm text-slate-300">Home team</label>
            <input
              name="home_team"
              required
              className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800"
            />
          </div>

          <div>
            <label className="text-sm text-slate-300">Away team</label>
            <input
              name="away_team"
              required
              className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800"
            />
          </div>

          <div>
            <label className="text-sm text-slate-300">Kickoff</label>
            <input
              name="kickoff_at"
              type="datetime-local"
              required
              className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800"
            />
          </div>

          <div>
            <label className="text-sm text-slate-300">Competition</label>
            <input
              name="competition"
              defaultValue={defaultCompetitionName ?? "Premier League"}
              required
              className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800"
            />
          </div>
        </div>

        {timingWindowText ? (
          <label className="flex gap-3 rounded-xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">
            <input
              type="checkbox"
              name="confirm_timing_override"
              value="1"
              className="mt-1 h-4 w-4 accent-amber-300"
            />
            <span>
              If this fixture is outside the usual gameweek window (
              {timingWindowText}), add it anyway.
            </span>
          </label>
        ) : null}

        <SubmitButton
          idleLabel="Add fixture"
          pendingLabel="Adding fixture..."
          className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950"
        />
      </form>
    </div>
  );
}
