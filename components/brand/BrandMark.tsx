type BrandMarkProps = {
  compact?: boolean;
  centered?: boolean;
};

export default function BrandMark({
  compact = false,
  centered = false,
}: BrandMarkProps) {
  return (
    <div
      className={`flex min-w-0 items-center gap-3 ${
        centered ? "flex-col text-center" : ""
      }`}
    >
      <div className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl border border-emerald-300/30 bg-[#10243a] shadow-lg shadow-black/30">
        <div className="absolute inset-x-2 top-1/2 h-px bg-emerald-300/35" />
        <div className="absolute inset-y-2 left-1/2 w-px bg-emerald-300/25" />
        <div className="absolute h-5 w-5 rounded-full border border-emerald-300/30" />
        <span className="relative text-[11px] font-black tracking-[-0.02em] text-emerald-200">
          WYG
        </span>
      </div>

      {!compact ? (
        <div className="min-w-0">
          <p className="truncate text-lg font-black tracking-tight text-white">
            Who You Got?
          </p>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300/90">
            Private league
          </p>
        </div>
      ) : null}
    </div>
  );
}
