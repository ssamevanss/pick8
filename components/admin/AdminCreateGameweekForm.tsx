import SubmitButton from "@/components/forms/SubmitButton";

type Profile = {
  id: string;
  display_name: string;
};

type AdminCreateGameweekFormProps = {
  activeSeasonId: string | null;
  nextGameweekNumber: number;
  profiles: Profile[];
  action: (formData: FormData) => void;
};

const fixtureNumbers = [1, 2, 3, 4];

export default function AdminCreateGameweekForm({
  activeSeasonId,
  nextGameweekNumber,
  profiles,
  action,
}: AdminCreateGameweekFormProps) {
  if (!activeSeasonId) {
    return (
      <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
        <h2 className="text-xl font-semibold">Create gameweek</h2>
        <p className="mt-2 text-sm text-slate-400">
          No active season found. Create an active season first.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
      <h2 className="text-xl font-semibold">Create gameweek</h2>
      <p className="mt-2 text-sm text-slate-400">
        Create an empty future gameweek, or add up to four fixtures now. Kickoff
        times are treated as London/Dublin time.
        </p>

      <form action={action} className="mt-4 space-y-4">
        <input type="hidden" name="season_id" value={activeSeasonId} />

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-sm text-slate-300">Gameweek number</label>
            <input
              name="gameweek_number"
              type="number"
              min="1"
              defaultValue={nextGameweekNumber}
              required
              className="mt-1 w-full rounded-lg bg-slate-950 px-3 py-2 outline-none ring-1 ring-slate-800"
            />
          </div>

          <div>
            <label className="text-sm text-slate-300">Gameweek name</label>
            <input
              name="name"
              defaultValue={`Gameweek ${nextGameweekNumber}`}
              className="mt-1 w-full rounded-lg bg-slate-950 px-3 py-2 outline-none ring-1 ring-slate-800"
            />
          </div>

          <div>
            <label className="text-sm text-slate-300">Fixture picker</label>
            <select
              name="fixture_picker_id"
              className="mt-1 w-full rounded-lg bg-slate-950 px-3 py-2 outline-none ring-1 ring-slate-800"
            >
              <option value="">No picker</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.display_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-3">
          {fixtureNumbers.map((fixtureNumber) => (
            <div
              key={fixtureNumber}
              className="rounded-xl border border-slate-800 bg-slate-950 p-4"
            >
              <p className="mb-3 text-sm font-semibold">
                Fixture {fixtureNumber}
              </p>

              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <label className="text-sm text-slate-300">Home team</label>
                  <input
                    name={`home_team_${fixtureNumber}`}
                    className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800"
                  />
                </div>

                <div>
                  <label className="text-sm text-slate-300">Away team</label>
                  <input
                    name={`away_team_${fixtureNumber}`}
                    className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800"
                  />
                </div>

                <div>
                  <label className="text-sm text-slate-300">Kickoff</label>
                  <input
                    name={`kickoff_at_${fixtureNumber}`}
                    type="datetime-local"
                    className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800"
                  />
                </div>

                <div>
                  <label className="text-sm text-slate-300">Competition</label>
                  <input
                    name={`competition_${fixtureNumber}`}
                    defaultValue="Premier League"
                    className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <SubmitButton
            idleLabel="Create gameweek"
            pendingLabel="Creating gameweek..."
            className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950"
        />
      </form>
    </section>
  );
}