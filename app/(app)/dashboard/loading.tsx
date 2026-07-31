export default function DashboardLoading() {
  return (
    <div aria-label="Loading dashboard" aria-busy="true">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="brand-card p-4">
            <div className="h-3 w-24 animate-pulse rounded bg-slate-800/70" />
            <div className="mt-3 h-8 w-14 animate-pulse rounded-lg bg-slate-700/70" />
          </div>
        ))}
      </section>

      <section className="brand-card mt-4 p-4 sm:p-5">
        <div className="h-5 w-36 animate-pulse rounded bg-slate-700/70" />
        <div className="mt-3 h-16 animate-pulse rounded-xl bg-slate-900/70" />
      </section>

      <section className="brand-card mt-4 p-4 sm:p-5">
        <div className="h-5 w-28 animate-pulse rounded bg-slate-700/70" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-14 animate-pulse rounded-xl bg-slate-900/70"
            />
          ))}
        </div>
      </section>
    </div>
  );
}
