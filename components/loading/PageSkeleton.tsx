type PageSkeletonProps = {
  title?: string;
  subtitle?: string;
  showSummaryCards?: boolean;
  cardCount?: number;
};

function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-800 ${className}`} />;
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
      <SkeletonLine className="h-3 w-40" />

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex-1 space-y-2">
          <SkeletonLine className="h-4 w-32" />
          <SkeletonLine className="h-4 w-28" />
        </div>

        <div className="flex items-center gap-2">
          <SkeletonLine className="h-10 w-12 rounded-lg" />
          <SkeletonLine className="h-4 w-3" />
          <SkeletonLine className="h-10 w-12 rounded-lg" />
        </div>
      </div>

      <SkeletonLine className="mt-4 h-12 w-full rounded-lg" />
    </div>
  );
}

export default function PageSkeleton({
  title = "Loading",
  subtitle = "Getting things ready...",
  showSummaryCards = false,
  cardCount = 4,
}: PageSkeletonProps) {
  return (
    <>
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-slate-400">{subtitle}</p>
      </header>

      {showSummaryCards ? (
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-slate-900 p-4 shadow-lg">
            <SkeletonLine className="h-4 w-20" />
            <SkeletonLine className="mt-3 h-8 w-12" />
          </div>

          <div className="rounded-2xl bg-slate-900 p-4 shadow-lg">
            <SkeletonLine className="h-4 w-24" />
            <SkeletonLine className="mt-3 h-8 w-16" />
          </div>

          <div className="rounded-2xl bg-slate-900 p-4 shadow-lg">
            <SkeletonLine className="h-4 w-20" />
            <SkeletonLine className="mt-3 h-8 w-12" />
          </div>
        </section>
      ) : null}

      <section className="mt-8 rounded-2xl bg-slate-900 p-4 shadow-lg">
        <SkeletonLine className="mb-4 h-14 w-full rounded-2xl" />

        <div className="mb-4">
          <SkeletonLine className="h-6 w-40" />
          <SkeletonLine className="mt-2 h-4 w-64" />
        </div>

        <div className="space-y-3">
          {Array.from({ length: cardCount }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      </section>
    </>
  );
}