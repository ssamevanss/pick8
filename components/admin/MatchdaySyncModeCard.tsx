import SubmitButton from "@/components/forms/SubmitButton";
import { updateMatchdayFixtureSyncMode } from "@/app/(app)/admin/fixture-sync-actions";

type MatchdayMode = {
  id: string;
  number: number;
  seasonName: string;
  status: string;
  mode: string;
  canChange: boolean;
};

export default function MatchdaySyncModeCard({ matchdays }: { matchdays: MatchdayMode[] }) {
  return (
    <section className="brand-card mb-6 p-5 sm:p-6">
      <p className="brand-eyebrow">Fixture ownership</p>
      <h2 className="mt-2 text-2xl font-black text-white">Matchday Sync Mode</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Provider matchdays follow the authoritative Who You Got fixture set. Manual matchdays keep local fixtures and scores; cron only recalculates Pick8 scoring from that local state.</p>
      <div className="mt-5 space-y-3">
        {matchdays.map((matchday) => (
          <form key={matchday.id} action={updateMatchdayFixtureSyncMode} className="flex flex-wrap items-end justify-between gap-3 border-t border-white/10 pt-3 first:border-0 first:pt-0">
            <input type="hidden" name="matchday_id" value={matchday.id} />
            <div><p className="font-black text-white">{matchday.seasonName} · Matchday {matchday.number}</p><p className="mt-1 text-xs capitalize text-slate-400">{matchday.status} · {matchday.mode} managed</p></div>
            <div className="flex min-w-[16rem] flex-1 items-end justify-end gap-2 sm:flex-initial">
              <label className="min-w-36 text-xs text-slate-400">Fixture sync mode<select className="brand-input mt-1" name="fixture_sync_mode" defaultValue={matchday.mode} disabled={!matchday.canChange}><option value="provider">Provider</option><option value="manual">Manual</option></select></label>
              <SubmitButton idleLabel="Save mode" pendingLabel="Saving…" className="brand-button-secondary" disabled={!matchday.canChange} />
            </div>
            {!matchday.canChange ? <p className="w-full text-xs text-amber-200">Mode is locked because this matchday has started, has a submitted entry, or has scoring data.</p> : null}
          </form>
        ))}
      </div>
    </section>
  );
}
