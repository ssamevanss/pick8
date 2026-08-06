"use client";

import { useActionState, useMemo, useState } from "react";
import {
  recalculateScoresAction,
  type ScoreActionState,
} from "@/app/(app)/admin/score-actions";

type SeasonOption = { id: string; name: string };
type MatchdayOption = { id: string; seasonId: string; number: number; status: string };
const initialState: ScoreActionState = { ok: false, message: "" };

export default function ScoreRecalculationCard({ seasons, matchdays }: { seasons: SeasonOption[]; matchdays: MatchdayOption[] }) {
  const [seasonId, setSeasonId] = useState(seasons[0]?.id ?? "");
  const availableMatchdays = useMemo(
    () => matchdays.filter((matchday) => matchday.seasonId === seasonId),
    [matchdays, seasonId],
  );
  const [state, formAction, pending] = useActionState(recalculateScoresAction, initialState);

  return (
    <section className="brand-card mb-6 p-5 sm:p-6">
      <p className="brand-eyebrow">Results</p>
      <h2 className="mt-2 text-2xl font-black text-white">Score Recalculation</h2>
      <p className="mt-2 text-sm text-slate-300">Recalculate selection points and finalize entry totals when every fixture is terminal.</p>
      <form action={formAction} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-slate-300">Season<select className="brand-input" name="season_id" value={seasonId} onChange={(event) => setSeasonId(event.target.value)} required>{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}</select></label>
        <label className="text-sm text-slate-300">Matchday<select className="brand-input" name="matchday_id" defaultValue="" key={seasonId} required><option value="" disabled>Choose matchday</option>{availableMatchdays.map((matchday) => <option key={matchday.id} value={matchday.id}>Matchday {matchday.number} · {matchday.status}</option>)}</select></label>
        <button className="brand-button-primary sm:col-span-2 sm:w-fit" type="submit" disabled={pending || !seasonId || !availableMatchdays.length}>{pending ? "Recalculating…" : "Recalculate Scores"}</button>
      </form>
      {state.message ? <div className={`mt-5 ${state.ok ? "brand-alert-success" : "brand-alert-danger"}`} role="status"><p className="font-semibold">{state.message}</p>{state.summary ? <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><dt className="opacity-70">Entries found</dt><dd>{state.summary.entriesFound}</dd></div><div><dt className="opacity-70">Selections scored</dt><dd>{state.summary.selectionsScored}</dd></div><div><dt className="opacity-70">Awaiting results</dt><dd>{state.summary.selectionsAwaitingResults}</dd></div><div><dt className="opacity-70">Void selections</dt><dd>{state.summary.voidSelections}</dd></div><div><dt className="opacity-70">Entries finalized</dt><dd>{state.summary.entriesFinalized}</dd></div><div><dt className="opacity-70">Entries skipped</dt><dd>{state.summary.entriesSkipped}</dd></div><div><dt className="opacity-70">Final ready</dt><dd>{state.summary.finalScoringReady ? "Yes" : "No"}</dd></div><div><dt className="opacity-70">Recalculated</dt><dd>{new Date(state.summary.recalculatedAt).toLocaleString()}</dd></div></dl> : null}</div> : null}
    </section>
  );
}
