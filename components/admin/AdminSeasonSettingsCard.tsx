"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import SubmitButton from "@/components/forms/SubmitButton";
import type { FootballCompetitionOption } from "@/utils/football-competitions";

export type AdminSeasonSettingsSeason = {
  id: string;
  name: string;
  status: string | null;
  base_provider: string | null;
  base_competition_code: string | null;
  base_competition_name: string | null;
  base_competition_external_id: string | null;
  provider_season: string | null;
  fixture_import_enabled: boolean | null;
  result_sync_enabled: boolean | null;
};

type AdminSeasonSettingsCardProps = {
  activeSeason: AdminSeasonSettingsSeason | null;
  competitionOptions: FootballCompetitionOption[];
  action: (formData: FormData) => Promise<void>;
};

export default function AdminSeasonSettingsCard({
  activeSeason,
  competitionOptions,
  action,
}: AdminSeasonSettingsCardProps) {
  const [provider, setProvider] = useState(
    activeSeason?.base_provider ?? "none",
  );
  const [competitionCode, setCompetitionCode] = useState(
    activeSeason?.base_competition_code ??
      competitionOptions[0]?.external_competition_code ??
      "PL",
  );
  const [fixtureImportEnabled, setFixtureImportEnabled] = useState(
    Boolean(activeSeason?.fixture_import_enabled),
  );
  const [resultSyncEnabled, setResultSyncEnabled] = useState(
    Boolean(activeSeason?.result_sync_enabled),
  );

  const selectedCompetition = useMemo(
    () =>
      competitionOptions.find(
        (option) => option.external_competition_code === competitionCode,
      ) ?? competitionOptions[0],
    [competitionCode, competitionOptions],
  );

  if (!activeSeason) {
    return (
      <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
        <h2 className="text-xl font-semibold">Season settings</h2>
        <p className="mt-3 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-300">
          Activate a season before configuring provider settings.
        </p>
      </section>
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (
      !activeSeason?.fixture_import_enabled &&
      fixtureImportEnabled &&
      !window.confirm("This allows real provider fixture imports into the cache.")
    ) {
      event.preventDefault();
      return;
    }

    if (
      !activeSeason?.result_sync_enabled &&
      resultSyncEnabled &&
      !window.confirm(
        "This allows automated result sync for selected external fixtures.",
      )
    ) {
      event.preventDefault();
    }
  }

  const providerConfigured = provider === "football_data";

  function handleProviderChange(value: string) {
    setProvider(value);

    if (value !== "football_data") {
      setFixtureImportEnabled(false);
      setResultSyncEnabled(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
      <h2 className="text-xl font-semibold">Season settings</h2>
      <p className="mt-2 text-sm text-slate-400">
        Configure the active season provider, base competition, and automation
        toggles without editing SQL.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl bg-slate-950 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Active season
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {activeSeason.name}
          </p>
        </div>

        <div className="rounded-xl bg-slate-950 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Status
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {activeSeason.status ?? "unknown"}
          </p>
        </div>
      </div>

      <form action={action} onSubmit={handleSubmit} className="mt-4 space-y-4">
        <input type="hidden" name="season_id" value={activeSeason.id} />
        <input
          type="hidden"
          name="base_competition_name"
          value={providerConfigured ? selectedCompetition?.name ?? "" : ""}
        />
        <input
          type="hidden"
          name="base_competition_external_id"
          value={
            providerConfigured
              ? selectedCompetition?.external_competition_id ?? ""
              : ""
          }
        />

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-300">
            Base provider
            <select
              name="base_provider"
              value={provider}
              onChange={(event) => handleProviderChange(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            >
              <option value="none">None</option>
              <option value="football_data">football_data</option>
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-300">
            Base competition
            <select
              name="base_competition_code"
              value={competitionCode}
              onChange={(event) => setCompetitionCode(event.target.value)}
              disabled={!providerConfigured}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {competitionOptions.map((option) => (
                <option
                  key={option.external_competition_code}
                  value={option.external_competition_code}
                >
                  {option.external_competition_code} - {option.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl bg-slate-950 p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">
              Competition name
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              {providerConfigured
                ? selectedCompetition?.name ?? "Not set"
                : "Not set"}
            </p>
          </div>

          <div className="rounded-xl bg-slate-950 p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">
              Provider ID
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              {providerConfigured
                ? selectedCompetition?.external_competition_id ?? "Not set"
                : "Not set"}
            </p>
          </div>

          <label className="block rounded-xl bg-slate-950 p-3 text-sm font-medium text-slate-300">
            Provider season
            <input
              name="provider_season"
              defaultValue={activeSeason.provider_season ?? ""}
              placeholder="Optional, e.g. 2026"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
            <input
              name="fixture_import_enabled"
              type="checkbox"
              checked={fixtureImportEnabled}
              onChange={(event) => setFixtureImportEnabled(event.target.checked)}
              disabled={!providerConfigured}
              className="mt-1"
            />
            <span>
              <span className="block font-semibold text-white">
                Fixture import enabled
              </span>
              <span className="mt-1 block text-slate-400">
                Allows real provider fixture imports into the local cache.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
            <input
              name="result_sync_enabled"
              type="checkbox"
              checked={resultSyncEnabled}
              onChange={(event) => setResultSyncEnabled(event.target.checked)}
              disabled={!providerConfigured}
              className="mt-1"
            />
            <span>
              <span className="block font-semibold text-white">
                Result sync enabled
              </span>
              <span className="mt-1 block text-slate-400">
                Allows cron/manual sync of selected external fixture results.
              </span>
            </span>
          </label>
        </div>

        <SubmitButton
          idleLabel="Save season settings"
          pendingLabel="Saving settings..."
          className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950"
        />
      </form>
    </section>
  );
}
