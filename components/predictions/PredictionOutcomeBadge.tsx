import type { Prediction } from "./types";

type PredictionOutcomeBadgeProps = {
  prediction: Prediction;
};

function getPredictionOutcome(prediction: Prediction) {
  if (prediction.points === null) {
    return null;
  }

  if (prediction.is_exact_score) {
    return {
      label: "Score",
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
}: PredictionOutcomeBadgeProps) {
  const outcome = getPredictionOutcome(prediction);

  if (!outcome) {
    return <span className="text-xs text-slate-500">Pending</span>;
  }

  return (
    <span
      className={`inline-flex min-w-24 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${outcome.className}`}
    >
      <span>{outcome.icon}</span>
      <span>{outcome.label}</span>
    </span>
  );
}