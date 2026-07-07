type RankMedalProps = {
  rank: number | null | undefined;
  showLabel?: boolean;
};

const medals: Record<
  number,
  { icon: string; label: string; className: string }
> = {
  1: {
    icon: "🥇",
    label: "Gold",
    className: "border-amber-300/40 bg-amber-300/15 text-amber-200",
  },
  2: {
    icon: "🥈",
    label: "Silver",
    className: "border-slate-200/40 bg-slate-200/15 text-slate-100",
  },
  3: {
    icon: "🥉",
    label: "Bronze",
    className: "border-orange-300/40 bg-orange-400/15 text-orange-200",
  },
};

export function getRankMedal(rank: number | null | undefined) {
  return rank ? medals[rank] ?? null : null;
}

export default function RankMedal({ rank, showLabel = false }: RankMedalProps) {
  const medal = getRankMedal(rank);

  if (!medal) {
    return null;
  }

  return (
    <span
      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-black ${medal.className}`}
      aria-label={`${medal.label} medal for ${rank}${rank === 1 ? "st" : rank === 2 ? "nd" : "rd"} place`}
      title={`${medal.label} medal`}
    >
      <span aria-hidden="true" className="text-sm leading-none">
        {medal.icon}
      </span>
      {showLabel ? <span>{medal.label}</span> : null}
    </span>
  );
}
