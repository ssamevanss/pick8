import PageSkeleton from "@/components/loading/PageSkeleton";

export default function AdminLoading() {
  return (
    <PageSkeleton
      title="Admin"
      subtitle="Loading admin tools and selected gameweek..."
      cardCount={4}
    />
  );
}