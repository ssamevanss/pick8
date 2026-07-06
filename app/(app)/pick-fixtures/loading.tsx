import PageSkeleton from "@/components/loading/PageSkeleton";

export default function PickFixturesLoading() {
  return (
    <PageSkeleton
      title="Pick Fixtures"
      subtitle="Loading fixture options and your assigned gameweek..."
      cardCount={4}
    />
  );
}
