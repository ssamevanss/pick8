import Link from "next/link";

export default function PendingPage() {
  return (
    <main className="app-surface flex min-h-screen items-center justify-center px-4 py-8 text-white">
      <div className="brand-card w-full max-w-md p-6 text-center shadow-xl sm:p-8">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-emerald-400 text-xl font-black text-slate-950">
          W
        </div>
        <p className="mt-3 text-lg font-black tracking-tight">
          Who You Got?
        </p>

        <h1 className="mt-4 text-3xl font-bold">Pending approval</h1>

        <p className="mt-3 text-sm text-slate-400">
          Your account has been created and is waiting for an admin to approve
          it. Once approved, you’ll be able to access the dashboard.
        </p>

        <Link
          href="/logout"
          className="brand-button-secondary mt-6"
        >
          Sign out
        </Link>
      </div>
    </main>
  );
}
