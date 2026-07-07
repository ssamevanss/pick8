import type { Prediction } from "./types";

type PredictionOutcomeBadgeProps = {
  prediction: Prediction;
  compact?: boolean;
};

function getPredictionOutcome(prediction: Prediction) {
  if (prediction.points === null) {
    return {
      label: "Pending",
      icon: null,
      className: "bg-slate-700/50 text-slate-300 ring-slate-600/50",
    };
  }

  if (prediction.is_exact_score) {
    return {
      label: "Exact",
      icon: "★",
      className: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    };
  }

  if (prediction.is_correct_result) {
    return {
      label: "Result",
      icon: "✓",
      className: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    };
  }

  return {
    label: "Incorrect",
    icon: "✕",
    className: "bg-red-500/15 text-red-300 ring-red-500/30",
  };
}

export default function PredictionOutcomeBadge({
  prediction,
  compact = false,
}: PredictionOutcomeBadgeProps) {
  const outcome = getPredictionOutcome(prediction);
  const pointsLabel =
    prediction.points === null
      ? null
      : `${prediction.points} pt${prediction.points === 1 ? "" : "s"}`;

  if (compact) {
    return (
      <span
        className={`inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-full px-2 text-[10px] font-black uppercase tracking-wide ring-1 ${outcome.className}`}
        title={pointsLabel ? `${outcome.label}, ${pointsLabel}` : outcome.label}
      >
        <span>{outcome.label}</span>
        {pointsLabel ? (
          <span className="border-l border-current/30 pl-1 normal-case tracking-normal">
            {prediction.points}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex min-w-24 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${outcome.className}`}
    >
      {outcome.icon ? <span>{outcome.icon}</span> : null}
      <span>{outcome.label}</span>
      {pointsLabel ? (
        <span className="font-semibold text-current/80">· {pointsLabel}</span>
      ) : null}
    </span>
  );
}
