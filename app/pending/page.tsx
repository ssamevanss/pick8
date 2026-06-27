import Link from "next/link";

export default function PendingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-white">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 p-6 text-center shadow-xl">
        <p className="text-sm font-medium text-emerald-400">
          Football Predictor
        </p>

        <h1 className="mt-4 text-3xl font-bold">Pending approval</h1>

        <p className="mt-3 text-sm text-slate-400">
          Your account has been created and is waiting for an admin to approve
          it. Once approved, you’ll be able to access the dashboard.
        </p>

        <Link
          href="/logout"
          className="mt-6 inline-flex rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300"
        >
          Sign out
        </Link>
      </div>
    </main>
  );
}