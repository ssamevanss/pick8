import { getRequestAuthContext } from "@/utils/app-context";

export default async function DashboardPage() {
  const { profile } = await getRequestAuthContext();

  return (
    <section className="brand-card p-5 sm:p-7">
      <p className="brand-eyebrow">Pick8</p>
      <h1 className="brand-title mt-2">
        Welcome, {profile?.display_name?.trim() || "Player"}
      </h1>
      <p className="brand-subtitle mt-3">
        Your private competition dashboard is ready for the next development
        phase.
      </p>
    </section>
  );
}
