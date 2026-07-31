type AdminScopeLeague = {
  id: string;
  name: string;
  status: string;
};

type AdminScopeSelectorProps = {
  tab: "seasons" | "maintenance";
  leagues: AdminScopeLeague[];
  selectedLeagueId: string | null;
  selectedLeagueName: string | null;
  activeSeasonName: string | null;
  allowAll: boolean;
};

export default function AdminScopeSelector({
  tab,
  leagues,
  selectedLeagueId,
  selectedLeagueName,
  activeSeasonName,
  allowAll,
}: AdminScopeSelectorProps) {
  return (
    <section className="brand-card mt-6 p-4 sm:p-5">
      <div className="brand-section-header">
        <p className="brand-eyebrow">Working context</p>
        <h2 className="text-xl font-black tracking-tight">
          Select a league
        </h2>
        <p className="brand-subtitle">
          Global lists remain global. Season, fixture, result, provider, and
          scoring operations use the league context selected here.
        </p>
      </div>

      <form action="/admin" method="get" className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <input type="hidden" name="tab" value={tab} />
        <label className="min-w-0 flex-1 text-sm font-semibold text-slate-300">
          League
          <select
            name="league"
            defaultValue={selectedLeagueId ?? "all"}
            className="brand-input mt-1"
          >
            {allowAll ? <option value="all">All leagues</option> : null}
            {leagues.map((league) => (
              <option key={league.id} value={league.id}>
                {league.name}{league.status !== "active" ? ` (${league.status})` : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="brand-button-secondary shrink-0">
          Apply context
        </button>
      </form>

      <div className="brand-card-soft mt-4 grid gap-3 p-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
            League
          </p>
          <p className="mt-1 font-semibold text-white">
            {selectedLeagueName ?? "All leagues"}
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Active season
          </p>
          <p className="mt-1 font-semibold text-white">
            {selectedLeagueId
              ? activeSeasonName ?? "This league is between seasons"
              : "Select a league for season-specific tools"}
          </p>
        </div>
      </div>
    </section>
  );
}
