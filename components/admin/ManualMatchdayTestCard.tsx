"use client";

import { useActionState } from "react";
import {
  createManualMatchdayTest,
  finalizeManualMatchday2Test,
  finalizeManualMatchdayTest,
  type ScoreActionState,
} from "@/app/(app)/admin/score-actions";

const initialState: ScoreActionState = { ok: false, message: "" };

export default function ManualMatchdayTestCard({
  matchday2Available,
  testMatchdayNumber,
  testMatchdayState,
}: {
  matchday2Available: boolean;
  testMatchdayNumber: number;
  testMatchdayState: "missing" | "ready" | "completed" | "unexpected";
}) {
  const [matchday2Result, matchday2Action, matchday2Pending] = useActionState(finalizeManualMatchday2Test, initialState);
  const [createResult, createAction, createPending] = useActionState(createManualMatchdayTest, initialState);
  const [testResult, testAction, testPending] = useActionState(finalizeManualMatchdayTest, initialState);
  return (
    <section className="brand-card mb-6 p-5 sm:p-6">
      <p className="brand-eyebrow">Accelerated lifecycle test</p>
      <h2 className="mt-2 text-2xl font-black text-white">Manual matchday tests</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Create and progress accelerated manual matchdays without involving provider fixture or result sync.</p>

      {matchday2Available ? <div className="mt-5 border-t border-white/10 pt-5"><h3 className="text-lg font-black text-white">Finalize Manual Matchday 2</h3><p className="mt-1 text-sm leading-6 text-slate-300">Assign the audited fake final scores, then run normal Pick8 scoring and finalisation.</p><form action={matchday2Action} className="mt-4 space-y-4"><label className="flex items-start gap-3 text-sm text-amber-100"><input type="checkbox" name="confirm_final_scores" required className="mt-0.5 h-5 w-5 accent-emerald-400" /><span>I confirm Matchday 2 should receive the ten fake final scores and run normal scoring.</span></label><button type="submit" className="brand-button-primary w-full sm:w-auto" disabled={matchday2Pending}>{matchday2Pending ? "Finalizing…" : "Apply fake finals and score Matchday 2"}</button></form>{matchday2Result.message ? <p className={`mt-4 ${matchday2Result.ok ? "brand-alert-success" : "brand-alert-danger"}`} role="status">{matchday2Result.message}</p> : null}</div> : null}

      <div className="mt-5 border-t border-white/10 pt-5">
        <h3 className="text-lg font-black text-white">Manual Matchday {testMatchdayNumber}</h3>
        {testMatchdayState === "missing" ? <><p className="mt-1 text-sm leading-6 text-slate-300">Create ten synthetic fixtures from existing stored teams and crests, scheduled between 24 and 42 hours from creation.</p><form action={createAction} className="mt-4"><input type="hidden" name="test_matchday_number" value={testMatchdayNumber} /><button type="submit" className="brand-button-primary w-full sm:w-auto" disabled={createPending}>{createPending ? "Creating…" : `Create manual Matchday ${testMatchdayNumber}`}</button></form></> : null}
        {testMatchdayState === "ready" ? <><p className="mt-1 text-sm leading-6 text-slate-300">This accelerated test will bypass synthetic fixture kickoff times and run normal final scoring. This exception is available only for manual test matchdays created by this tool.</p><form action={testAction} className="mt-4 space-y-4"><input type="hidden" name="test_matchday_number" value={testMatchdayNumber} /><label className="flex items-start gap-3 text-sm text-amber-100"><input type="checkbox" name="confirm_accelerated_final_scores" required className="mt-0.5 h-5 w-5 accent-emerald-400" /><span>I confirm Manual Matchday {testMatchdayNumber} should bypass its synthetic kickoff times, receive fake final scores, and run normal scoring.</span></label><button type="submit" className="brand-button-primary w-full sm:w-auto" disabled={testPending}>{testPending ? "Finalizing…" : `Apply fake finals and score Matchday ${testMatchdayNumber}`}</button></form></> : null}
        {testMatchdayState === "completed" ? <p className="brand-alert-success mt-3">Manual Matchday {testMatchdayNumber} is completed.</p> : null}
        {testMatchdayState === "unexpected" ? <p className="brand-alert-danger mt-3">Matchday {testMatchdayNumber} already exists without the exact accelerated-test marker, manual mode, or synthetic fixture data. No test action will modify it.</p> : null}
        {createResult.message ? <p className={`mt-4 ${createResult.ok ? "brand-alert-success" : "brand-alert-danger"}`} role="status">{createResult.message}</p> : null}
        {testResult.message ? <p className={`mt-4 ${testResult.ok ? "brand-alert-success" : "brand-alert-danger"}`} role="status">{testResult.message}</p> : null}
      </div>
    </section>
  );
}
