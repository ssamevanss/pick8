import PageSkeleton from "@/components/loading/PageSkeleton";

export default function PredictionsLoading() {
  return (
    <PageSkeleton
      title="Predictions"
      subtitle="Loading fixtures, predictions, and leaderboard position..."
      showSummaryCards
      cardCount={4}
    />
  );
}