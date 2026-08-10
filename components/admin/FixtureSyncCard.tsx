"use client";

import { useActionState } from "react";
import {
  syncFixturesAction,
  type FixtureSyncActionState,
} from "@/app/(app)/admin/fixture-sync-actions";

const initialState: FixtureSyncActionState = { ok: false, message: "" };

export default function FixtureSyncCard() {
  const [state, formAction, pending] = useActionState(
    syncFixturesAction,
    initialState,
  );

  return (
    <section className="brand-card mb-6 p-5 sm:p-6">
      <p className="brand-eyebrow">Data import</p>
      <h2 className="mt-2 text-2xl font-black text-white">Fixture Sync</h2>
      <p className="mt-2 text-sm leading-6 text-slate-300">
        Import one Premier League matchday from Who You Got. Fixture teams,
        kickoff, matchday assignment, status, and scores are provider-managed.
      </p>

      <form action={formAction} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-slate-300">
          Season start year
          <input
            className="brand-input"
            name="season"
            type="number"
            min="2000"
            max="2100"
            defaultValue={new Date().getFullYear()}
            required
          />
        </label>
        <label className="text-sm text-slate-300">
          Matchday number
          <input
            className="brand-input"
            name="matchday"
            type="number"
            min="1"
            max="38"
            defaultValue="1"
            required
          />
        </label>
        <button
          className="brand-button-primary sm:col-span-2 sm:w-fit"
          type="submit"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Syncing…" : "Sync Fixtures"}
        </button>
      </form>

      {state.message ? (
        <div
          className={`mt-5 ${state.ok ? "brand-alert-success" : "brand-alert-danger"}`}
          role="status"
          aria-live="polite"
        >
          <p className="font-semibold">{state.message}</p>
          {state.summary ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <div><dt className="opacity-70">Season</dt><dd>{state.summary.season}</dd></div>
              <div><dt className="opacity-70">Matchday</dt><dd>{state.summary.matchday}</dd></div>
              <div><dt className="opacity-70">Received</dt><dd>{state.summary.received}</dd></div>
              <div><dt className="opacity-70">Inserted</dt><dd>{state.summary.inserted}</dd></div>
              <div><dt className="opacity-70">Updated</dt><dd>{state.summary.updated}</dd></div>
              <div><dt className="opacity-70">Unchanged</dt><dd>{state.summary.unchanged}</dd></div>
              <div><dt className="opacity-70">Stale rows removed</dt><dd>{state.summary.removed}</dd></div>
              <div><dt className="opacity-70">Entries returned to draft</dt><dd>{state.summary.invalidatedEntries}</dd></div>
              <div className="col-span-2 sm:col-span-3">
                <dt className="opacity-70">Sync timestamp</dt>
                <dd>{new Date(state.summary.syncedAt).toLocaleString()}</dd>
              </div>
            </dl>
          ) : null}
          {state.summary?.potentialRemovals.length ? (
            <p className="mt-3 text-sm">
              {state.summary.potentialRemovals.length} local fixture(s) were not
              returned and require explicit reconciliation.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
