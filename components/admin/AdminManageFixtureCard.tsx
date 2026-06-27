import { formatInTimeZone } from "date-fns-tz";
import type { Fixture } from "@/components/predictions/types";
import {
  deleteFixture,
  updateFixtureDetails,
} from "@/app/(app)/admin/actions";

type AdminManageFixtureCardProps = {
  fixture: Fixture;
};

export default function AdminManageFixtureCard({
  fixture,
}: AdminManageFixtureCardProps) {
  const kickoffValue = formatInTimeZone(
    fixture.kickoff_at,
    "Europe/London",
    "yyyy-MM-dd'T'HH:mm",
  );

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
      <form action={updateFixtureDetails} className="space-y-3">
        <input type="hidden" name="fixture_id" value={fixture.id} />

        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="text-sm text-slate-300">Home team</label>
            <input
              name="home_team"
              defaultValue={fixture.home_team}
              required
              className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800"
            />
          </div>

          <div>
            <label className="text-sm text-slate-300">Away team</label>
            <input
              name="away_team"
              defaultValue={fixture.away_team}
              required
              className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800"
            />
          </div>

          <div>
            <label className="text-sm text-slate-300">Kickoff</label>
            <input
              name="kickoff_at"
              type="datetime-local"
              defaultValue={kickoffValue}
              required
              className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800"
            />
          </div>

          <div>
            <label className="text-sm text-slate-300">Competition</label>
            <input
              name="competition"
              defaultValue={fixture.competition}
              required
              className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-slate-500">Status: {fixture.status}</p>

          <button className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950">
            Save fixture
          </button>
        </div>
      </form>

      <form
        action={deleteFixture}
        className="mt-3 border-t border-slate-800 pt-3"
      >
        <input type="hidden" name="fixture_id" value={fixture.id} />

        <button className="rounded-lg border border-red-900 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-950">
          Delete fixture
        </button>

        <p className="mt-2 text-xs text-slate-500">
          Delete is blocked if predictions already exist for this fixture.
        </p>
      </form>
    </div>
  );
}