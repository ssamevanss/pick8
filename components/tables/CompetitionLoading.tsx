export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block shrink-0 rounded-full border-2 border-emerald-300/30 border-t-emerald-300 motion-safe:animate-spin ${className}`} />;
}

/** Streamed fallback while a competition's standings load; keyed per competition by the page. */
export default function CompetitionLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <p className="flex items-center gap-2 text-sm font-bold text-slate-200"><Spinner />Loading competition…</p>
      <div className="brand-table" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 border-b border-white/10 px-4 py-3 last:border-b-0">
            <div className="h-6 w-10 animate-pulse rounded-full bg-slate-800/80" />
            <div className="h-4 flex-1 animate-pulse rounded bg-slate-800/80" />
            <div className="h-4 w-12 animate-pulse rounded bg-slate-800/80" />
          </div>
        ))}
      </div>
    </div>
  );
}
