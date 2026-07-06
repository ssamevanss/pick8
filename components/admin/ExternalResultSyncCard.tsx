"use client";

import { useState } from "react";

export type ExternalResultSyncSummary = {
  activeSeasonId: string | null;
  activeSeasonName: string | null;
  baseProvider: string | null;
  baseCompetitionCode: string | null;
  baseCompetitionName: string | null;
  selectedExternalFixtureCount: number;
  lastExternalSyncAt: string | null;
};

type SyncResult = {
  dry_run?: boolean;
  fixtures_checked?: number;
  planned_updates?: unknown[];
  skipped?: unknown[];
  updated_count?: number;
  scored_count?: number;
  recalculated_leaderboard?: boolean;
  api_call_count?: number;
  error?: string;
};

type ExternalResultSyncCardProps = {
  summary: ExternalResultSyncSummary;
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatJson(value: unknown) {
  return JSON.stringify(value ?? [], null, 2);
}

export default function ExternalResultSyncCard({
  summary,
}: ExternalResultSyncCardProps) {
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<"dry-run" | "sync" | null>(
    null,
  );

  async function runSync(mode: "dry-run" | "sync") {
    if (!summary.activeSeasonId) {
      setError("No active season found.");
      return;
    }

    if (
      mode === "sync" &&
      !window.confirm("Run external result sync and update scores/leaderboard?")
    ) {
      return;
    }

    const params = new URLSearchParams({
      season_id: summary.activeSeasonId,
    });

    const endpoint =
      mode === "sync"
        ? `/api/admin/external-fixtures/sync-results?${params.toString()}&dry_run=0`
        : `/api/admin/external-fixtures/sync-results?${params.toString()}`;

    setIsLoading(true);
    setActiveAction(mode);
    setError(null);

    try {
      const response = await fetch(endpoint, {
        method: mode === "sync" ? "POST" : "GET",
      });
      const payload = (await response.json()) as SyncResult;

      setResult(payload);

      if (!response.ok) {
        setError(payload.error ?? `Result sync failed with ${response.status}.`);
      }
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Result sync request failed.",
      );
    } finally {
      setIsLoading(false);
      setActiveAction(null);
    }
  }

  const providerLabel =
    summary.baseProvider && summary.baseCompetitionCode
      ? `${summary.baseProvider} / ${summary.baseCompetitionCode}`
      : "Not configured";

  return (
    <div className="rounded-2xl bg-slate-900 p-4 shadow-lg">
      <h2 className="text-xl font-semibold">External result sync</h2>
      <p className="mt-2 text-sm text-slate-400">
        Manually check selected external fixtures and apply final scores when
        the provider marks them finished.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl bg-slate-950 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Active season
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {summary.activeSeasonName ?? "No active season"}
          </p>
        </div>

        <div className="rounded-xl bg-slate-950 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Provider
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {providerLabel}
          </p>
          {summary.baseCompetitionName ? (
            <p className="mt-1 text-xs text-slate-400">
              {summary.baseCompetitionName}
            </p>
          ) : null}
        </div>

        <div className="rounded-xl bg-slate-950 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Linked fixtures
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {summary.selectedExternalFixtureCount}
          </p>
        </div>

        <div className="rounded-xl bg-slate-950 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Last external sync
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {formatDateTime(summary.lastExternalSyncAt)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => runSync("dry-run")}
          disabled={!summary.activeSeasonId || isLoading}
          className="rounded-lg border border-emerald-500/40 px-4 py-3 text-sm font-semibold text-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading && activeAction === "dry-run"
            ? "Running dry-run..."
            : "Dry-run result sync"}
        </button>

        <button
          type="button"
          onClick={() => runSync("sync")}
          disabled={!summary.activeSeasonId || isLoading}
          className="rounded-lg bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading && activeAction === "sync"
            ? "Running real sync..."
            : "Run result sync"}
        </button>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl bg-red-950 p-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3">
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <p>
              <span className="block text-xs uppercase text-slate-500">
                Fixtures checked
              </span>
              <span className="font-semibold text-white">
                {result.fixtures_checked ?? 0}
              </span>
            </p>
            <p>
              <span className="block text-xs uppercase text-slate-500">
                API calls
              </span>
              <span className="font-semibold text-white">
                {result.api_call_count ?? 0}
              </span>
            </p>
            <p>
              <span className="block text-xs uppercase text-slate-500">
                Updated
              </span>
              <span className="font-semibold text-white">
                {result.updated_count ?? 0}
              </span>
            </p>
            <p>
              <span className="block text-xs uppercase text-slate-500">
                Scored
              </span>
              <span className="font-semibold text-white">
                {result.scored_count ?? 0}
              </span>
            </p>
            <p>
              <span className="block text-xs uppercase text-slate-500">
                Leaderboard
              </span>
              <span className="font-semibold text-white">
                {result.recalculated_leaderboard ? "Recalculated" : "No change"}
              </span>
            </p>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-200">
                planned_updates
              </h3>
              <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-300">
                {formatJson(result.planned_updates)}
              </pre>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-200">skipped</h3>
              <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-300">
                {formatJson(result.skipped)}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
