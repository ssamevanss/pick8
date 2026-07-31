import PageSkeleton from "@/components/loading/PageSkeleton";

export default function AdminLoading() {
  return (
    <PageSkeleton
      title="Platform Admin"
      subtitle="Loading admin tools and selected gameweek..."
      cardCount={4}
    />
  );
}
