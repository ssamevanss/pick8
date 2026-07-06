import { addFixtureToGameweek } from "@/app/(app)/admin/actions";
import SubmitButton from "@/components/forms/SubmitButton";

type AdminAddFixtureFormProps = {
  gameweekId: string | null;
};

export default function AdminAddFixtureForm({
  gameweekId,
}: AdminAddFixtureFormProps) {
  if (!gameweekId) {
    return null;
  }

  return (
    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950 p-4">
      <h3 className="text-lg font-semibold">Add fixture</h3>
      <p className="mt-1 text-sm text-slate-400">
        Add another fixture to the selected gameweek.
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
              defaultValue="Premier League"
              required
              className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800"
            />
          </div>
        </div>

        <SubmitButton
          idleLabel="Add fixture"
          pendingLabel="Adding fixture..."
          className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950"
        />
      </form>
    </div>
  );
}
