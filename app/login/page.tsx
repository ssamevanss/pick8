import Link from "next/link";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const params = searchParams ? await searchParams : {};

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-white">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 p-6 shadow-xl">
        <p className="text-sm font-medium text-emerald-400">
          Football Predictor
        </p>

        <h1 className="mt-4 text-3xl font-bold">Sign in</h1>

        <p className="mt-2 text-sm text-slate-400">
          Enter your details to access the private league.
        </p>

        {params.error ? (
          <p className="mt-4 rounded-lg bg-red-950 p-3 text-sm text-red-300">
            {params.error}
          </p>
        ) : null}

        <form action={login} className="mt-6 space-y-4">
          <div>
            <label className="text-sm text-slate-300">Email</label>
            <input
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded-lg bg-slate-950 px-3 py-2 outline-none ring-1 ring-slate-800"
            />
          </div>

          <div>
            <label className="text-sm text-slate-300">Password</label>
            <input
              name="password"
              type="password"
              required
              className="mt-1 w-full rounded-lg bg-slate-950 px-3 py-2 outline-none ring-1 ring-slate-800"
            />
          </div>

          <button className="w-full rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950">
            Sign in
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-400">
          Need an account?{" "}
          <Link href="/signup" className="font-semibold text-emerald-400">
            Create account
          </Link>
        </p>
      </div>
    </main>
  );
}