"use client";

import { useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import { footballDataCompetitionOptions } from "@/utils/football-competitions";

type ImportResult = {
  dry_run?: boolean;
  competition_code?: string;
  provider_calls_made?: number;
  fetched_count?: number;
  upserted_count?: number;
  planned_updates?: unknown[];
  skipped?: unknown[];
  sample?: unknown[];
  error?: string;
};

type ExternalFixtureImportCardProps = {
  activeSeasonId: string | null;
  activeSeasonName: string | null;
  baseCompetitionCode?: string | null;
};

function formatJson(value: unknown) {
  return JSON.stringify(value ?? [], null, 2);
}

export default function ExternalFixtureImportCard({
  activeSeasonId,
  activeSeasonName,
  baseCompetitionCode = null,
}: ExternalFixtureImportCardProps) {
  const { showToast } = useToast();
  const [competitionCode, setCompetitionCode] = useState(
    baseCompetitionCode ?? footballDataCompetitionOptions[0]?.external_competition_code ?? "PL",
  );
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<"dry-run" | "import" | null>(
    null,
  );

  async function runImport(mode: "dry-run" | "import") {
    if (!activeSeasonId) {
      setError("No active season found.");
      return;
    }

    if (
      mode === "import" &&
      !window.confirm(`Import ${competitionCode} fixtures into the external cache?`)
    ) {
      return;
    }

    const params = new URLSearchParams({
      season_id: activeSeasonId,
      competition_code: competitionCode,
      dry_run: mode === "import" ? "0" : "1",
    });

    setIsLoading(true);
    setActiveAction(mode);
    setError(null);

    try {
      const response = await fetch(`/api/admin/external-fixtures/import?${params}`, {
        method: mode === "import" ? "POST" : "GET",
      });
      const payload = (await response.json()) as ImportResult;

      setResult(payload);

      if (!response.ok) {
        setError(payload.error ?? `Fixture import failed with ${response.status}.`);
        return;
      }

      showToast({
        title: "Maintenance action completed",
        description:
          mode === "import"
            ? "External fixtures imported."
            : "Dry-run external import completed.",
      });
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Fixture import request failed.",
      );
    } finally {
      setIsLoading(false);
      setActiveAction(null);
    }
  }

  return (
    <div className="mt-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="min-w-0">
          <span className="text-sm font-semibold text-slate-300">
            Competition to import
          </span>
          <select
            value={competitionCode}
            onChange={(event) => setCompetitionCode(event.target.value)}
            className="brand-input mt-1"
            disabled={isLoading}
          >
            {footballDataCompetitionOptions.map((competition) => (
              <option
                key={competition.external_competition_code}
                value={competition.external_competition_code}
              >
                {competition.name} ({competition.external_competition_code})
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => runImport("dry-run")}
          disabled={!activeSeasonId || isLoading}
          aria-busy={isLoading && activeAction === "dry-run"}
          className="rounded-lg border border-emerald-500/40 px-4 py-3 text-sm font-semibold text-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading && activeAction === "dry-run"
            ? "Running dry-run..."
            : "Dry-run import"}
        </button>

        <button
          type="button"
          onClick={() => runImport("import")}
          disabled={!activeSeasonId || isLoading}
          aria-busy={isLoading && activeAction === "import"}
          className="rounded-lg bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading && activeAction === "import"
            ? "Importing fixtures..."
            : "Import fixtures"}
        </button>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Active season: {activeSeasonName ?? "No active season"}. Imports write to
        the shared external fixture cache for the selected competition.
      </p>

      {error ? (
        <p className="mt-4 rounded-xl bg-red-950 p-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3">
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <p>
              <span className="block text-xs uppercase text-slate-500">
                Competition
              </span>
              <span className="font-semibold text-white">
                {result.competition_code ?? competitionCode}
              </span>
            </p>
            <p>
              <span className="block text-xs uppercase text-slate-500">
                Provider calls
              </span>
              <span className="font-semibold text-white">
                {result.provider_calls_made ?? 0}
              </span>
            </p>
            <p>
              <span className="block text-xs uppercase text-slate-500">
                Fetched
              </span>
              <span className="font-semibold text-white">
                {result.fetched_count ?? result.upserted_count ?? 0}
              </span>
            </p>
            <p>
              <span className="block text-xs uppercase text-slate-500">
                Upserted
              </span>
              <span className="font-semibold text-white">
                {result.upserted_count ?? (result.dry_run ? "Dry-run" : 0)}
              </span>
            </p>
          </div>

          <details className="mt-4 rounded-lg border border-white/10 bg-slate-900 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-200">
              Sample fixtures / raw dry-run details
            </summary>
            <pre className="mt-3 max-h-96 overflow-auto text-xs text-slate-300">
              {formatJson({
                planned_updates: result.planned_updates,
                skipped: result.skipped,
                sample: result.sample,
              })}
            </pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}
