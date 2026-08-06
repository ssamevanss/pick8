"use client";

import { useActionState } from "react";
import { refreshCompetitionsAction, type CompetitionActionState } from "@/app/(app)/admin/competition-actions";

const initial: CompetitionActionState = { ok: false, message: "" };

export default function CompetitionRefreshCard() {
  const [state, action, pending] = useActionState(refreshCompetitionsAction, initial);
  return <section className="brand-card mb-6 p-5 sm:p-6"><p className="brand-eyebrow">Season setup</p><h2 className="mt-2 text-2xl font-black text-white">Competitions</h2><p className="mt-2 text-sm leading-6 text-slate-300">Create any missing Pick8 mini-competitions and refresh their current statuses.</p><form action={action} className="mt-4"><button className="brand-button-primary" disabled={pending}>{pending ? "Refreshing…" : "Refresh Competitions"}</button></form>{state.message ? <div className={`mt-4 ${state.ok ? "brand-alert-success" : "brand-alert-danger"}`} role="status"><p>{state.message}</p>{state.summary ? <dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-slate-400">Season</dt><dd>{state.summary.season}</dd></div><div><dt className="text-slate-400">Inserted</dt><dd>{state.summary.inserted}</dd></div><div><dt className="text-slate-400">Statuses updated</dt><dd>{state.summary.statusesUpdated}</dd></div><div><dt className="text-slate-400">Active</dt><dd>{state.summary.activeCompetition ?? "None"}</dd></div><div className="col-span-2"><dt className="text-slate-400">Timestamp</dt><dd>{new Date(state.summary.refreshedAt).toLocaleString()}</dd></div></dl> : null}</div> : null}</section>;
}
