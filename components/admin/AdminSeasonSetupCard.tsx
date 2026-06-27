import SubmitButton from "@/components/forms/SubmitButton";

type AdminSeasonSetupCardProps = {
  activeSeasonId: string | null;
  activeSeasonName: string | null;
  existingGameweekCount: number;
  action: (formData: FormData) => void;
};

export default function AdminSeasonSetupCard({
  activeSeasonId,
  activeSeasonName,
  existingGameweekCount,
  action,
}: AdminSeasonSetupCardProps) {
  return (
    <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
      <h2 className="text-xl font-semibold">Season setup</h2>

      <p className="mt-2 text-sm text-slate-400">
        Generate the full set of gameweeks for the active season. Existing
        gameweeks will not be duplicated.
      </p>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4">
        <p className="text-sm text-slate-400">Active season</p>
        <p className="mt-1 font-semibold">
          {activeSeasonName ?? "No active season"}
        </p>

        <p className="mt-3 text-sm text-slate-400">
          Existing gameweeks:{" "}
          <span className="font-semibold text-white">
            {existingGameweekCount}
          </span>
        </p>
      </div>

      {activeSeasonId ? (
        <form action={action} className="mt-4 space-y-4">
          <input type="hidden" name="season_id" value={activeSeasonId} />

          <div>
            <label className="text-sm text-slate-300">
              Generate gameweeks up to
            </label>
            <input
              name="target_count"
              type="number"
              min="1"
              max="60"
              defaultValue={38}
              required
              className="mt-1 w-full rounded-lg bg-slate-950 px-3 py-2 outline-none ring-1 ring-slate-800"
            />
          </div>

          <SubmitButton
            idleLabel="Generate missing gameweeks"
            pendingLabel="Generating gameweeks..."
            className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950"
          />
        </form>
      ) : (
        <p className="mt-4 rounded-xl bg-red-950 p-3 text-sm text-red-300">
          No active season found.
        </p>
      )}
    </section>
  );
}