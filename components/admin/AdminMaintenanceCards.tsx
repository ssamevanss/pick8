import SubmitButton from "@/components/forms/SubmitButton";

export type MaintenanceSeasonOption = {
  id: string;
  name: string;
  status: "draft" | "active" | "archived";
};

export type HealthSeverity = "ok" | "warning" | "error";

export type HealthCheckRow = {
  label: string;
  value: string;
  severity: HealthSeverity;
  detail?: string;
};

type AdminMaintenanceCardsProps = {
  activeSeasonId: string | null;
  activeSeasonName: string | null;
  seasons: MaintenanceSeasonOption[];
  healthChecks: HealthCheckRow[];
  recalculateAction: () => void;
  rescoreAction?: () => void;
};

function getSeverityClass(severity: HealthSeverity) {
  if (severity === "ok") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }

  if (severity === "warning") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  }

  return "border-red-500/30 bg-red-500/10 text-red-300";
}

function getDotClass(severity: HealthSeverity) {
  if (severity === "ok") {
    return "bg-emerald-400";
  }

  if (severity === "warning") {
    return "bg-amber-400";
  }

  return "bg-red-400";
}

export default function AdminMaintenanceCards({
  activeSeasonId,
  activeSeasonName,
  seasons,
  healthChecks,
  recalculateAction,
  rescoreAction,
}: AdminMaintenanceCardsProps) {
  return (
    <section className="mt-6 space-y-6">
      <div className="rounded-2xl bg-slate-900 p-4 shadow-lg">
        <h2 className="text-xl font-semibold">Season export</h2>
        <p className="mt-2 text-sm text-slate-400">
          Download a JSON backup for a selected season. Activity is included
          only when it can be matched to that season safely.
        </p>

        <p className="mt-3 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-300">
          Download an export before deleting seasons, changing schema, or making
          risky admin changes.
        </p>

        <form
          action="/admin/maintenance/export"
          method="get"
          className="mt-4 space-y-3"
        >
          <label className="block text-sm text-slate-300">
            Season
            <select
              name="season_id"
              defaultValue={activeSeasonId ?? seasons[0]?.id ?? ""}
              disabled={seasons.length === 0}
              className="mt-1 w-full rounded-lg bg-slate-950 px-3 py-2 outline-none ring-1 ring-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name} ({season.status})
                </option>
              ))}
            </select>
          </label>

          <p className="rounded-xl bg-slate-950 p-3 text-sm text-slate-400">
            Default: {activeSeasonName ?? "No active season found"}. Export
            includes season, profiles, gameweeks, fixtures, predictions,
            joker usage, leaderboard entries, and safely matched notifications.
          </p>

          <button
            type="submit"
            disabled={seasons.length === 0}
            className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Download season JSON
          </button>
        </form>
      </div>

      <div className="rounded-2xl bg-slate-900 p-4 shadow-lg">
        <h2 className="text-xl font-semibold">Health check</h2>
        <p className="mt-2 text-sm text-slate-400">
          Quick checks for the active season, data completeness, scoring, and
          required environment variables.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {healthChecks.map((check) => (
            <div
              key={check.label}
              className={`rounded-xl border p-3 ${getSeverityClass(
                check.severity,
              )}`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-1 h-2.5 w-2.5 rounded-full ${getDotClass(
                    check.severity,
                  )}`}
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{check.label}</p>
                  <p className="mt-1 text-lg font-bold text-white">
                    {check.value}
                  </p>
                  {check.detail ? (
                    <p className="mt-1 text-xs opacity-80">{check.detail}</p>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-slate-900 p-4 shadow-lg">
        <h2 className="text-xl font-semibold">Leaderboard maintenance</h2>
        <p className="mt-2 text-sm text-slate-400">
          Rebuild active-season leaderboard totals from already scored
          predictions. This does not re-score fixtures.
        </p>

        <p className="mt-3 rounded-xl bg-slate-950 p-3 text-sm text-slate-400">
          If results were edited directly in SQL, use the re-score button to
          refresh prediction points before trusting the leaderboard.
        </p>

        <form action={recalculateAction} className="mt-4">
          <SubmitButton
            idleLabel="Recalculate active leaderboard"
            pendingLabel="Recalculating leaderboard..."
            className="w-full rounded-lg border border-emerald-500/40 px-4 py-3 text-sm font-semibold text-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </form>

        {rescoreAction ? (
          <form action={rescoreAction} className="mt-3">
            <SubmitButton
              idleLabel="Re-score completed fixtures"
              pendingLabel="Re-scoring fixtures..."
              className="w-full rounded-lg bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </form>
        ) : null}
      </div>
    </section>
  );
}
