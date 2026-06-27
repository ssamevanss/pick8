import PageSkeleton from "@/components/loading/PageSkeleton";

export default function DashboardLoading() {
  return (
    <PageSkeleton
      title="Home"
      subtitle="Loading your league hub..."
      cardCount={3}
    />
  );
}