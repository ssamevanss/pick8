// Route-level fallback so navigating to /tables paints immediately while the server loads the standings.
const pulse = "animate-pulse rounded bg-slate-800/80";

export default function TablesLoading() {
  return (
    <div className="space-y-6" aria-label="Loading tables" aria-busy="true">
      <header className="brand-card p-5 sm:p-7">
        <div className={`${pulse} h-3 w-20`} />
        <h1 className="brand-title mt-2">Tables</h1>
        <p className="brand-subtitle mt-2">Competition standings, overall scores, and locked-matchday picks.</p>
      </header>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="min-h-11 animate-pulse rounded-xl border border-white/10 bg-slate-800/50" />
        ))}
      </div>
      <section className="space-y-3" aria-hidden="true">
        <div className={`${pulse} h-3 w-28`} />
        <div className={`${pulse} h-7 w-48`} />
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="brand-card-soft h-16 animate-pulse bg-slate-800/40" />
        ))}
      </section>
    </div>
  );
}
