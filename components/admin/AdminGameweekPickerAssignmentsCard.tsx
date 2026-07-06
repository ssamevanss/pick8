import SubmitButton from "@/components/forms/SubmitButton";
import ConfirmCheckbox from "@/components/forms/ConfirmCheckbox";

type Profile = {
  id: string;
  display_name: string;
  status: string;
};

export type GameweekPickerAssignmentRow = {
  id: string;
  gameweek_number: number;
  name: string | null;
  fixture_picker_id: string | null;
  is_double_gameweek: boolean;
  fixtures:
    | {
        id: string;
        status?: string;
        predictions?: { id: string }[] | null;
      }[]
    | null;
};

type AdminGameweekPickerAssignmentsCardProps = {
  activeSeasonId: string | null;
  gameweeks: GameweekPickerAssignmentRow[];
  profiles: Profile[];
  saveAction: (formData: FormData) => Promise<void>;
  autoAssignAllAction: (formData: FormData) => Promise<void>;
  autoAssignFutureAction: (formData: FormData) => Promise<void>;
};

function formatGameweekName(gameweek: GameweekPickerAssignmentRow) {
  return gameweek.name || `Gameweek ${gameweek.gameweek_number}`;
}

export default function AdminGameweekPickerAssignmentsCard({
  activeSeasonId,
  gameweeks,
  profiles,
  saveAction,
  autoAssignAllAction,
  autoAssignFutureAction,
}: AdminGameweekPickerAssignmentsCardProps) {
  const approvedProfiles = profiles.filter(
    (profile) => profile.status === "approved",
  );

  return (
    <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
      <div>
        <h2 className="text-xl font-semibold">Gameweek picker assignments</h2>
        <p className="mt-2 text-sm text-slate-400">
          Assign the fixture picker for each gameweek directly. This is the
          schedule players will follow during the season.
        </p>
      </div>

      {!activeSeasonId ? (
        <p className="mt-4 rounded-xl bg-slate-950 p-4 text-sm text-amber-300">
          Create or activate a season before assigning fixture pickers.
        </p>
      ) : null}

      {activeSeasonId ? (
        <div className="mt-4 flex flex-col gap-2 md:flex-row">
          <form action={autoAssignAllAction} className="flex-1">
            <input type="hidden" name="season_id" value={activeSeasonId} />
            <SubmitButton
              idleLabel="Auto-assign all gameweeks"
              pendingLabel="Assigning..."
              className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950"
            />
          </form>

          <form action={autoAssignFutureAction} className="flex-1">
            <input type="hidden" name="season_id" value={activeSeasonId} />
            <SubmitButton
              idleLabel="Reassign unpicked gameweeks"
              pendingLabel="Reassigning..."
              className="w-full rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300"
            />
          </form>
        </div>
      ) : null}

      {activeSeasonId && gameweeks.length === 0 ? (
        <p className="mt-4 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
          No gameweeks exist for the active season yet.
        </p>
      ) : null}

      {activeSeasonId && gameweeks.length > 0 ? (
        <form action={saveAction} className="mt-4">
          <div className="overflow-hidden rounded-xl border border-slate-800">
            {gameweeks.map((gameweek) => {
              const fixtureCount = gameweek.fixtures?.length ?? 0;
              const hasPredictions = Boolean(
                gameweek.fixtures?.some(
                  (fixture) => (fixture.predictions?.length ?? 0) > 0,
                ),
              );
              const hasCompletedFixtures = Boolean(
                gameweek.fixtures?.some((fixture) => fixture.status === "completed"),
              );

              return (
                <div
                  key={gameweek.id}
                  className="grid gap-3 border-t border-slate-800 bg-slate-950 p-3 first:border-t-0 md:grid-cols-[1fr_220px_180px_120px]"
                >
                  <div>
                    <input
                      type="hidden"
                      name="gameweek_id"
                      value={gameweek.id}
                    />
                    <p className="font-semibold">
                      {formatGameweekName(gameweek)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {fixtureCount} fixture{fixtureCount === 1 ? "" : "s"}{" "}
                      selected
                    </p>
                  </div>

                  <label className="text-sm text-slate-300">
                    Picker
                    <select
                      name={`fixture_picker_id_${gameweek.id}`}
                      defaultValue={gameweek.fixture_picker_id ?? "unassigned"}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
                    >
                      <option value="unassigned">Unassigned</option>
                      {approvedProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.display_name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-slate-300">
                    <ConfirmCheckbox
                      name={`is_double_gameweek_${gameweek.id}`}
                      defaultChecked={gameweek.is_double_gameweek}
                      ariaLabel={`Mark ${formatGameweekName(
                        gameweek,
                      )} as a Double Gameweek`}
                      confirmWhenChecking={
                        hasPredictions
                          ? "Make this a Double Gameweek? Existing Jokers for this gameweek will be removed and scores may be recalculated."
                          : "Make this a Double Gameweek? All points will count 2x and Jokers cannot be used."
                      }
                      confirmWhenUnchecking={
                        hasPredictions || hasCompletedFixtures
                          ? "Disable Double Gameweek? Existing scores may need recalculation."
                          : undefined
                      }
                      className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-amber-300"
                    />
                    <span>
                      <span className="block font-semibold text-white">
                        Double Gameweek
                      </span>
                      <span className="mt-1 block text-xs text-slate-400">
                        All points are doubled. Jokers cannot be used this gameweek.
                      </span>
                    </span>
                  </label>

                  <div className="flex items-end">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        fixtureCount > 0
                          ? "bg-slate-800 text-slate-300"
                          : "bg-emerald-500/10 text-emerald-300"
                      }`}
                    >
                      {fixtureCount > 0 ? "Picked" : "Editable"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <SubmitButton
            idleLabel="Save picker assignments"
            pendingLabel="Saving assignments..."
            className="mt-4 w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950"
          />
        </form>
      ) : null}
    </section>
  );
}
