import SubmitButton from "@/components/forms/SubmitButton";

export type AdminSeasonRow = {
  id: string;
  name: string;
  status: "draft" | "active" | "archived";
  is_active: boolean;
  season_type: string;
  description: string | null;
  show_in_archive: boolean;
  provider_season: string | null;
  base_provider: string | null;
  base_competition_code: string | null;
  base_competition_name: string | null;
  fixture_import_enabled: boolean;
  result_sync_enabled: boolean;
  created_at: string;
  archived_at: string | null;
};

type AdminSeasonControlsCardProps = {
  seasons: AdminSeasonRow[];
  createSeasonAction: (formData: FormData) => Promise<void>;
  rolloverSeasonAction: (formData: FormData) => Promise<void>;
  activateSeasonAction: (formData: FormData) => Promise<void>;
  archiveSeasonAction: (formData: FormData) => Promise<void>;
  restoreSeasonAction: (formData: FormData) => Promise<void>;
  updateArchiveVisibilityAction: (formData: FormData) => Promise<void>;
  deleteSeasonAction: (formData: FormData) => Promise<void>;
  activeGameweekCount: number;
};

function formatDate(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getStatusClasses(status: AdminSeasonRow["status"]) {
  if (status === "active") {
    return "bg-emerald-500/10 text-emerald-300";
  }

  if (status === "draft") {
    return "bg-amber-500/10 text-amber-300";
  }

  return "bg-slate-700 text-slate-300";
}

function getSeasonTypeLabel(value: string) {
  if (value === "world_cup") {
    return "World Cup / Cup";
  }

  if (value === "test") {
    return "Test";
  }

  return "Standard";
}

export default function AdminSeasonControlsCard({
  seasons,
  createSeasonAction,
  rolloverSeasonAction,
  activateSeasonAction,
  archiveSeasonAction,
  restoreSeasonAction,
  updateArchiveVisibilityAction,
  deleteSeasonAction,
  activeGameweekCount,
}: AdminSeasonControlsCardProps) {
  const activeSeason = seasons.find((season) => season.status === "active");
  const currentYear = new Date().getFullYear();
  const nextSeasonName = activeSeason?.name
    ? activeSeason.name.replace(/\b\d{4}\b/, String(currentYear + 1))
    : `${currentYear}/${String(currentYear + 1).slice(-2)} Season`;

  return (
    <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
      <div>
        <h2 className="text-xl font-semibold">Season management</h2>
        <p className="mt-2 text-sm text-slate-400">
          Create test seasons, activate the current competition, and archive old
          seasons when they are finished.
        </p>
      </div>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4">
        <p className="text-sm font-semibold text-slate-400">
          Current active season
        </p>

        {activeSeason ? (
          <>
            <h3 className="mt-1 text-2xl font-bold">{activeSeason.name}</h3>
            <p className="mt-1 text-sm text-slate-400">
              {getSeasonTypeLabel(activeSeason.season_type)} season · Created{" "}
              {formatDate(activeSeason.created_at)}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-amber-300">
            No active season. Players will not have a live season until one is
            activated.
          </p>
        )}
      </div>

      <form
        action={createSeasonAction}
        className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4"
      >
        <h3 className="text-lg font-semibold">Create new season</h3>

        <label className="mt-4 block text-sm font-medium text-slate-300">
          Season name
          <input
            name="name"
            required
            placeholder="2026/27 Test Season"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
          />
        </label>

        <label className="mt-3 block text-sm font-medium text-slate-300">
          Description
          <textarea
            name="description"
            rows={2}
            placeholder="Optional notes for admins"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
          />
        </label>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="block text-sm font-medium text-slate-300">
            Season type
            <select
              name="season_type"
              defaultValue="standard"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
            >
              <option value="standard">Standard</option>
              <option value="test">Test</option>
              <option value="world_cup">World Cup / Cup</option>
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-300">
            Gameweeks
            <input
              name="gameweek_count"
              type="number"
              min={0}
              max={60}
              defaultValue={38}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
            />
          </label>

          <label className="block text-sm font-medium text-slate-300">
            Initial status
            <select
              name="status"
              defaultValue="draft"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
            >
              <option value="draft">Draft / hidden</option>
              <option value="active">Active now</option>
            </select>
          </label>
        </div>

        <label className="mt-4 flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm text-slate-300">
            <input
                name="auto_assign_pickers"
                type="checkbox"
                defaultChecked
                className="mt-1"
            />
            <span>
                <span className="block font-semibold text-white">
                Auto-assign fixture pickers
                </span>
                <span className="mt-1 block text-slate-400">
                Assign gameweeks in rotation from the current approved users.
                </span>
            </span>
            </label>

        <p className="mt-3 text-xs text-slate-500">
          Creating a season as active will archive the current active season.
          Draft seasons are hidden from normal users.
        </p>

        <SubmitButton
          idleLabel="Create season"
          pendingLabel="Creating season..."
          className="mt-4 w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950"
        />
      </form>

      {activeSeason ? (
        <form
          action={rolloverSeasonAction}
          className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4"
        >
          <input
            type="hidden"
            name="source_season_id"
            value={activeSeason.id}
          />

          <div>
            <h3 className="text-lg font-semibold text-white">
              Archive and start next season
            </h3>
            <p className="mt-2 text-sm text-slate-300">
              Platform/admin rollover only. This preserves{" "}
              <span className="font-semibold text-white">{activeSeason.name}</span>{" "}
              as read-only history, creates a clean active season, generates
              gameweeks, and assigns fixture pickers.
            </p>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="block text-sm font-medium text-slate-300 md:col-span-2">
              Next season name
              <input
                name="name"
                required
                defaultValue={nextSeasonName}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
              />
            </label>

            <label className="block text-sm font-medium text-slate-300">
              Gameweeks
              <input
                name="gameweek_count"
                type="number"
                min={1}
                max={60}
                defaultValue={activeGameweekCount || 38}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
              />
            </label>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="block text-sm font-medium text-slate-300">
              Provider season
              <input
                name="provider_season"
                placeholder="Optional provider season/year"
                defaultValue={activeSeason.provider_season ?? ""}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
              />
            </label>

            <label className="block text-sm font-medium text-slate-300">
              Admin notes
              <input
                name="description"
                placeholder="Optional notes for admins"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
              />
            </label>
          </div>

          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
            <p>
              Copied settings:{" "}
              <span className="font-semibold text-slate-200">
                {activeSeason.base_competition_name ??
                  activeSeason.base_competition_code ??
                  "No provider competition"}
              </span>
              {activeSeason.base_provider ? ` · ${activeSeason.base_provider}` : ""}
              {activeSeason.fixture_import_enabled ? " · fixture import on" : ""}
              {activeSeason.result_sync_enabled ? " · result sync on" : ""}
            </p>
            <p className="mt-1">
              New season starts with no fixtures, predictions, joker usage,
              activity, comments, reactions, or scored leaderboard rows.
            </p>
          </div>

          <label className="mt-3 flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
            <input
              name="show_old_in_archive"
              type="checkbox"
              defaultChecked={activeSeason.show_in_archive}
              className="mt-1"
            />
            <span>
              <span className="block font-semibold text-white">
                Show old season in previous leaderboards
              </span>
              <span className="mt-1 block text-slate-400">
                Turn this off for trial/test seasons.
              </span>
            </span>
          </label>

          <p className="mt-3 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            Confirm before running: the current season becomes read-only history
            and users will see the new active season immediately.
          </p>

          <SubmitButton
            idleLabel="Archive current and start next"
            pendingLabel="Rolling over..."
            className="mt-4 w-full rounded-lg bg-amber-300 px-4 py-3 text-sm font-semibold text-slate-950"
          />
        </form>
      ) : null}

      <div className="mt-4 space-y-3">
        <h3 className="text-lg font-semibold">All seasons</h3>

        {seasons.length === 0 ? (
          <p className="rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
            No seasons found.
          </p>
        ) : null}

        {seasons.map((season) => (
          <div
            key={season.id}
            className="rounded-xl border border-slate-800 bg-slate-950 p-4"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-lg font-bold">{season.name}</h4>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${getStatusClasses(
                      season.status,
                    )}`}
                  >
                    {season.status}
                  </span>
                </div>

                <p className="mt-1 text-sm text-slate-400">
                  {getSeasonTypeLabel(season.season_type)} · Created{" "}
                  {formatDate(season.created_at)}
                  {season.archived_at
                    ? ` · Archived ${formatDate(season.archived_at)}`
                    : ""}
                </p>

                {season.status === "archived" ? (
                    <p className="mt-1 text-xs text-slate-500">
                        {season.show_in_archive
                        ? "Visible in previous season leaderboards"
                        : "Hidden from previous season leaderboards"}
                    </p>
                    ) : null}

                {season.description ? (
                  <p className="mt-2 text-sm text-slate-400">
                    {season.description}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-2 md:min-w-40">
                {season.status === "draft" ? (
                  <form action={activateSeasonAction}>
                    <input type="hidden" name="season_id" value={season.id} />
                    <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                      Activating this season archives any current active season.
                    </p>
                    <SubmitButton
                      idleLabel="Activate"
                      pendingLabel="Activating..."
                      className="w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950"
                    />
                  </form>
                ) : null}

                {season.status !== "archived" ? (
                  <form action={archiveSeasonAction}>
                    <input type="hidden" name="season_id" value={season.id} />
                    <SubmitButton
                      idleLabel="Archive"
                      pendingLabel="Archiving..."
                      className="w-full rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300"
                    />
                  </form>
                ) : null}

                {season.status === "archived" ? (
                    <>
                        <p className="rounded-lg bg-slate-900 px-3 py-2 text-center text-xs text-slate-500">
                        Read-only archive
                        </p>

                        <form action={restoreSeasonAction}>
                        <input type="hidden" name="season_id" value={season.id} />
                        <SubmitButton
                            idleLabel="Restore to draft"
                            pendingLabel="Restoring..."
                            className="w-full rounded-lg border border-amber-500/40 px-3 py-2 text-sm font-semibold text-amber-300"
                        />
                        </form>
                    </>
                    ) : null}
                {season.status === "archived" ? (
                    <form
                        action={updateArchiveVisibilityAction}
                        className="rounded-lg border border-slate-800 bg-slate-900 p-3"
                    >
                        <input type="hidden" name="season_id" value={season.id} />

                        <label className="flex items-start gap-2 text-xs text-slate-300">
                        <input
                            name="show_in_archive"
                            type="checkbox"
                            defaultChecked={season.show_in_archive}
                            className="mt-1"
                        />
                        <span>
                            <span className="block font-semibold">Show in previous seasons</span>
                            <span className="mt-1 block text-slate-500">
                            Turn this off for test seasons.
                            </span>
                        </span>
                        </label>

                        <SubmitButton
                        idleLabel="Save visibility"
                        pendingLabel="Saving..."
                        className="mt-3 w-full rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300"
                        />
                    </form>
                    ) : null}

                    {season.status !== "active" &&
                    (season.status === "draft" ||
                    season.season_type === "test" ||
                    season.season_type === "world_cup" ||
                    season.show_in_archive === false) ? (
                    <form
                        action={deleteSeasonAction}
                        className="rounded-lg border border-red-500/30 bg-red-500/5 p-3"
                    >
                        <input type="hidden" name="season_id" value={season.id} />

                        <p className="text-xs font-semibold text-red-300">Delete season</p>
                        <p className="mt-1 text-xs text-slate-500">
                        This permanently removes season data. Export first, and
                        only use this for test or hidden seasons. Type DELETE to confirm.
                        </p>

                        <input
                        name="confirm_text"
                        placeholder="DELETE"
                        className="mt-2 w-full rounded-lg border border-red-500/30 bg-slate-950 px-3 py-2 text-xs text-white"
                        />

                        <SubmitButton
                        idleLabel="Delete"
                        pendingLabel="Deleting..."
                        className="mt-2 w-full rounded-lg bg-red-500 px-3 py-2 text-xs font-semibold text-white"
                        />
                    </form>
                    ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
