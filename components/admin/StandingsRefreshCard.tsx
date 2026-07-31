"use client";

import { useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import { footballDataCompetitionOptions } from "@/utils/football-competitions";

type StandingsRefreshResult = {
  ok?: boolean;
  competition_code?: string;
  provider_calls_made?: number;
  fetched_count?: number;
  upserted_count?: number;
  planned_updates?: {
    team_name: string;
    position: number;
    played?: number | null;
    points?: number | null;
  }[];
  error?: string;
};

export default function StandingsRefreshCard({
  activeSeasonId,
  baseCompetitionCode,
}: {
  activeSeasonId: string | null;
  baseCompetitionCode?: string | null;
}) {
  const [competitionCode, setCompetitionCode] = useState(
    baseCompetitionCode ??
      footballDataCompetitionOptions[0]?.external_competition_code ??
      "PL",
  );
  const [result, setResult] = useState<StandingsRefreshResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<"dry-run" | "run" | null>(
    null,
  );
  const { showToast } = useToast();

  async function runRefresh(action: "dry-run" | "run") {
    if (
      action === "run" &&
      !window.confirm("Refresh cached standings for this competition?")
    ) {
      return;
    }

    setIsLoading(true);
    setActiveAction(action);
    setError(null);

    try {
      const params = new URLSearchParams({
        season_id: activeSeasonId ?? "",
        competition_code: competitionCode,
        dry_run: action === "dry-run" ? "1" : "0",
      });
      const response = await fetch(`/api/admin/refresh-standings?${params}`, {
        method: action === "dry-run" ? "GET" : "POST",
      });
      const json = (await response.json()) as StandingsRefreshResult;

      if (!response.ok || json.error) {
        throw new Error(json.error ?? "Standings refresh failed.");
      }

      setResult(json);
      showToast({
        title:
          action === "dry-run"
            ? "Standings dry-run complete"
            : "Standings refreshed",
      });
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Standings refresh failed.",
      );
    } finally {
      setIsLoading(false);
      setActiveAction(null);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/50 p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="min-w-0">
          <span className="text-sm font-semibold text-slate-300">
            Competition standings
          </span>
          <select
            value={competitionCode}
            onChange={(event) => setCompetitionCode(event.target.value)}
            disabled={isLoading}
            className="brand-input mt-1"
          >
            {footballDataCompetitionOptions
              .filter((competition) => competition.external_competition_code !== "WC")
              .map((competition) => (
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
          onClick={() => runRefresh("dry-run")}
          disabled={isLoading || !activeSeasonId}
          className="rounded-lg border border-emerald-500/40 px-3 py-2 text-sm font-semibold text-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading && activeAction === "dry-run"
            ? "Checking..."
            : "Dry-run standings"}
        </button>
        <button
          type="button"
          onClick={() => runRefresh("run")}
          disabled={isLoading || !activeSeasonId}
          className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading && activeAction === "run" ? "Refreshing..." : "Refresh standings"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl bg-red-950 p-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-slate-900/70 p-3 text-sm">
          <p className="font-semibold text-white">
            {result.competition_code ?? competitionCode}:{" "}
            {result.fetched_count ?? 0} teams fetched,{" "}
            {result.upserted_count ?? 0} upserted
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Provider calls: {result.provider_calls_made ?? 0}
          </p>
          {(result.planned_updates ?? []).length > 0 ? (
            <div className="mt-2 grid gap-1 text-xs text-slate-300">
              {result.planned_updates?.slice(0, 6).map((row) => (
                <p key={`${row.team_name}:${row.position}`}>
                  {row.position}. {row.team_name}
                  {row.points !== null && row.points !== undefined
                    ? ` · ${row.points} pts`
                    : ""}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
