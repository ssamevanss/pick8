function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-800 ${className}`} />;
}

export default function LeaderboardLoading() {
  return (
    <>
      <h1 className="text-3xl font-bold">Leaderboard</h1>

      <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="grid grid-cols-[40px_1fr_80px] items-center gap-3 rounded-xl bg-slate-950 p-4"
            >
              <SkeletonLine className="h-6 w-8" />
              <div>
                <SkeletonLine className="h-4 w-32" />
                <SkeletonLine className="mt-2 h-3 w-20" />
              </div>
              <SkeletonLine className="h-6 w-14 justify-self-end" />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}