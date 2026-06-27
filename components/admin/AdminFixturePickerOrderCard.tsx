import SubmitButton from "@/components/forms/SubmitButton";

type Profile = {
  id: string;
  display_name: string;
};

type FixturePickerOrder = {
  user_id: string;
  sort_order: number;
};

type AdminFixturePickerOrderCardProps = {
  activeSeasonId: string | null;
  profiles: Profile[];
  pickerOrder: FixturePickerOrder[];
  saveAction: (formData: FormData) => void;
  assignAction: (formData: FormData) => void;
};

export default function AdminFixturePickerOrderCard({
  activeSeasonId,
  profiles,
  pickerOrder,
  saveAction,
  assignAction,
}: AdminFixturePickerOrderCardProps) {
  const orderedUserIds =
    pickerOrder.length > 0
      ? [...pickerOrder]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((row) => row.user_id)
      : profiles.map((profile) => profile.id);

  const orderedProfiles = orderedUserIds
    .map((userId) => profiles.find((profile) => profile.id === userId))
    .filter((profile): profile is Profile => Boolean(profile));

  const missingProfiles = profiles.filter(
    (profile) => !orderedUserIds.includes(profile.id),
  );

  const displayProfiles = [...orderedProfiles, ...missingProfiles];

  return (
    <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
      <h2 className="text-xl font-semibold">Fixture picker order</h2>

      <p className="mt-2 text-sm text-slate-400">
        Set the rotation order, then assign pickers across all gameweeks in the
        active season.
      </p>

      {!activeSeasonId ? (
        <p className="mt-4 rounded-xl bg-red-950 p-3 text-sm text-red-300">
          No active season found.
        </p>
      ) : null}

      {activeSeasonId && profiles.length === 0 ? (
        <p className="mt-4 rounded-xl bg-slate-950 p-3 text-sm text-slate-400">
          No approved players found.
        </p>
      ) : null}

      {activeSeasonId && profiles.length > 0 ? (
        <>
          <form action={saveAction} className="mt-4 space-y-3">
            <input type="hidden" name="season_id" value={activeSeasonId} />

            {displayProfiles.map((profile, index) => (
              <div
                key={profile.id}
                className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3 md:grid-cols-[80px_1fr]"
              >
                <div>
                  <label className="text-xs text-slate-400">Order</label>
                  <input
                    name={`sort_order_${profile.id}`}
                    type="number"
                    min="1"
                    defaultValue={index + 1}
                    required
                    className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400">Player</label>
                  <input
                    value={profile.display_name}
                    readOnly
                    className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 text-slate-300 outline-none ring-1 ring-slate-800"
                  />
                  <input name="user_id" type="hidden" value={profile.id} />
                </div>
              </div>
            ))}

            <SubmitButton
              idleLabel="Save picker order"
              pendingLabel="Saving order..."
              className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950"
            />
          </form>

          {pickerOrder.length > 0 ? (
            <form action={assignAction} className="mt-3">
                <input type="hidden" name="season_id" value={activeSeasonId} />

                <SubmitButton
                idleLabel="Assign pickers to gameweeks"
                pendingLabel="Assigning pickers..."
                className="w-full rounded-lg border border-emerald-500/40 px-4 py-3 text-sm font-semibold text-emerald-300"
                />
            </form>
            ) : (
            <p className="mt-3 rounded-xl bg-slate-950 p-3 text-sm text-slate-400">
                Save the picker order first, then assign pickers to gameweeks.
            </p>
            )}
        </>
      ) : null}
    </section>
  );
}