import Link from "next/link";
import BrandMark from "@/components/brand/BrandMark";
import LoginForm from "@/components/auth/LoginForm";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; email?: string }>;
}) {
  const params = searchParams ? await searchParams : {};

  return (
    <main className="app-surface flex min-h-dvh items-center justify-center px-4 py-8 text-white">
      <div className="brand-card w-full max-w-md p-6 sm:p-8">
        <BrandMark />

        <h1 className="mt-4 text-3xl font-bold">Sign in</h1>

        <p className="mt-2 text-sm text-slate-400">
          Enter your details to access the private league.
        </p>

        {params.error ? (
          <p className="brand-alert-danger mt-4">
            {params.error}
          </p>
        ) : null}

        <LoginForm action={login} defaultEmail={params.email ?? ""} />

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
