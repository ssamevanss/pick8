"use client";

import { useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";

type AutoPickResult = {
  ok?: boolean;
  dry_run?: boolean;
  candidate_gameweeks?: {
    gameweek_id: string;
    gameweek_number: number;
    picker_name: string;
    time_until_first_kickoff: string;
    fixtures_needed: number;
    expected_count: number;
    due: boolean;
    would_select: {
      external_fixture_id: string;
      home_team: string;
      away_team: string;
      kickoff_at: string;
    }[];
  }[];
  created_count?: number;
  updated_gameweeks?: number;
  skipped?: { gameweek_number?: number; reason: string }[];
  error?: string;
};

export default function AutoPickFixturesCard() {
  const [result, setResult] = useState<AutoPickResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<"dry-run" | "run" | null>(
    null,
  );
  const { showToast } = useToast();

  async function runAutoPick(action: "dry-run" | "run") {
    if (
      action === "run" &&
      !window.confirm("Auto-pick missing fixtures for due gameweeks?")
    ) {
      return;
    }

    setIsLoading(true);
    setActiveAction(action);
    setError(null);

    try {
      const params = new URLSearchParams({
        dry_run: action === "dry-run" ? "1" : "0",
      });
      const response = await fetch(`/api/admin/auto-pick-fixtures?${params}`, {
        method: action === "dry-run" ? "GET" : "POST",
      });
      const json = (await response.json()) as AutoPickResult;

      if (!response.ok || json.error) {
        throw new Error(json.error ?? "Auto-pick request failed.");
      }

      setResult(json);
      showToast({
        title:
          action === "dry-run"
            ? "Auto-pick dry-run complete"
            : "Auto-pick complete",
      });
    } catch (autoPickError) {
      setError(
        autoPickError instanceof Error
          ? autoPickError.message
          : "Auto-pick request failed.",
      );
    } finally {
      setIsLoading(false);
      setActiveAction(null);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="font-semibold text-white">Auto-pick missed fixtures</h4>
          <p className="mt-1 text-sm text-slate-400">
            Fills missing picks from the active season base competition once the
            12-hour safety deadline has passed.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => runAutoPick("dry-run")}
            disabled={isLoading}
            aria-busy={isLoading && activeAction === "dry-run"}
            className="rounded-lg border border-emerald-500/40 px-3 py-2 text-sm font-semibold text-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading && activeAction === "dry-run"
              ? "Checking..."
              : "Dry-run auto-pick"}
          </button>
          <button
            type="button"
            onClick={() => runAutoPick("run")}
            disabled={isLoading}
            aria-busy={isLoading && activeAction === "run"}
            className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading && activeAction === "run" ? "Running..." : "Run auto-pick"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl bg-red-950 p-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            <p className="rounded-lg bg-slate-900/70 p-3">
              <span className="block text-xs uppercase text-slate-500">
                Candidate gameweeks
              </span>
              <span className="font-semibold text-white">
                {result.candidate_gameweeks?.length ?? 0}
              </span>
            </p>
            <p className="rounded-lg bg-slate-900/70 p-3">
              <span className="block text-xs uppercase text-slate-500">
                Fixtures created
              </span>
              <span className="font-semibold text-white">
                {result.created_count ?? 0}
              </span>
            </p>
            <p className="rounded-lg bg-slate-900/70 p-3">
              <span className="block text-xs uppercase text-slate-500">
                Gameweeks updated
              </span>
              <span className="font-semibold text-white">
                {result.updated_gameweeks ?? 0}
              </span>
            </p>
          </div>

          {(result.candidate_gameweeks ?? []).slice(0, 4).map((gameweek) => (
            <div
              key={gameweek.gameweek_id}
              className="rounded-lg border border-white/10 bg-slate-900/70 p-3"
            >
              <p className="font-semibold text-white">
                Gameweek {gameweek.gameweek_number} · {gameweek.picker_name}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {gameweek.fixtures_needed} needed of {gameweek.expected_count} ·
                first kickoff {gameweek.time_until_first_kickoff} ·{" "}
                {gameweek.due ? "due now" : "not due yet"}
              </p>
              <div className="mt-2 grid gap-1 text-xs text-slate-300">
                {gameweek.would_select.map((fixture) => (
                  <p key={fixture.external_fixture_id}>
                    {fixture.home_team} v {fixture.away_team}
                  </p>
                ))}
              </div>
            </div>
          ))}

          {(result.skipped ?? []).length > 0 ? (
            <details className="rounded-lg border border-white/10 bg-slate-900/70 p-3">
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-slate-400">
                Skipped ({result.skipped?.length})
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-300">
                {JSON.stringify(result.skipped, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
