import PageSkeleton from "@/components/loading/PageSkeleton";

export default function DashboardLoading() {
  return (
    <PageSkeleton
      title="Gameweek Dashboard"
      subtitle="Loading fixtures, predictions, and leaderboard position..."
      showSummaryCards
      cardCount={4}
    />
  );
}