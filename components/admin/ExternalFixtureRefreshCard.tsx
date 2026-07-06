"use client";

import { useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";

type RefreshResult = {
  dry_run?: boolean;
  skipped_run?: boolean;
  reason?: string;
  provider_calls_made?: number;
  external_fixtures_updated?: number;
  selected_app_fixtures_updated?: number;
  kickoff_changes?: number;
  team_name_changes?: number;
  planned_updates?: unknown[];
  skipped?: unknown[];
  error?: string;
};

function formatJson(value: unknown) {
  return JSON.stringify(value ?? [], null, 2);
}

export default function ExternalFixtureRefreshCard() {
  const { showToast } = useToast();
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<"dry-run" | "refresh" | null>(
    null,
  );

  async function runRefresh(mode: "dry-run" | "refresh") {
    if (
      mode === "refresh" &&
      !window.confirm("Refresh upcoming external fixtures and update safe fixture details?")
    ) {
      return;
    }

    const endpoint =
      mode === "refresh"
        ? "/api/admin/external-fixtures/refresh?dry_run=0"
        : "/api/admin/external-fixtures/refresh?dry_run=1";

    setIsLoading(true);
    setActiveAction(mode);
    setError(null);

    try {
      const response = await fetch(endpoint, {
        method: mode === "refresh" ? "POST" : "GET",
      });
      const payload = (await response.json()) as RefreshResult;

      setResult(payload);

      if (!response.ok) {
        setError(payload.error ?? `Fixture refresh failed with ${response.status}.`);
      } else {
        showToast({
          title: "Maintenance action completed",
          description:
            mode === "refresh"
              ? "Upcoming fixture refresh completed."
              : "Dry-run fixture refresh completed.",
        });
      }
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Fixture refresh request failed.",
      );
    } finally {
      setIsLoading(false);
      setActiveAction(null);
    }
  }

  return (
    <div className="rounded-2xl bg-slate-900 p-4 shadow-lg">
      <h2 className="text-xl font-semibold">External fixture refresh</h2>
      <p className="mt-2 text-sm text-slate-400">
        Refresh upcoming teams, kickoff times, provider status, and round metadata
        before matches kick off. Scores are not changed here.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => runRefresh("dry-run")}
          disabled={isLoading}
          aria-busy={isLoading && activeAction === "dry-run"}
          className="rounded-lg border border-emerald-500/40 px-4 py-3 text-sm font-semibold text-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading && activeAction === "dry-run"
            ? "Running dry-run..."
            : "Refresh upcoming fixtures dry-run"}
        </button>

        <button
          type="button"
          onClick={() => runRefresh("refresh")}
          disabled={isLoading}
          aria-busy={isLoading && activeAction === "refresh"}
          className="rounded-lg bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading && activeAction === "refresh"
            ? "Refreshing fixtures..."
            : "Refresh upcoming fixtures"}
        </button>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl bg-red-950 p-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3">
          {result.skipped_run ? (
            <p className="mb-3 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
              Skipped: {result.reason ?? "No eligible fixtures."}
            </p>
          ) : null}

          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
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
                Cache updates
              </span>
              <span className="font-semibold text-white">
                {result.external_fixtures_updated ?? 0}
              </span>
            </p>
            <p>
              <span className="block text-xs uppercase text-slate-500">
                Selected updates
              </span>
              <span className="font-semibold text-white">
                {result.selected_app_fixtures_updated ?? 0}
              </span>
            </p>
            <p>
              <span className="block text-xs uppercase text-slate-500">
                Kickoff changes
              </span>
              <span className="font-semibold text-white">
                {result.kickoff_changes ?? 0}
              </span>
            </p>
            <p>
              <span className="block text-xs uppercase text-slate-500">
                Team-name changes
              </span>
              <span className="font-semibold text-white">
                {result.team_name_changes ?? 0}
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
