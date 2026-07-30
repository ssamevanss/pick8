import Link from "next/link";
import BrandMark from "@/components/brand/BrandMark";
import SignupForm from "@/components/auth/SignupForm";
import { signup } from "./actions";

export default async function SignupPage({
  searchParams,
}: {
  searchParams?: Promise<{
    error?: string;
    email?: string;
    display_name?: string;
    league_code?: string;
  }>;
}) {
  const params = searchParams ? await searchParams : {};

  return (
    <main className="app-surface flex min-h-dvh items-center justify-center px-4 py-8 text-white">
      <div className="brand-card w-full max-w-md p-6 sm:p-8">
        <BrandMark />

        <h1 className="mt-4 text-3xl font-bold">Create account</h1>

        <p className="mt-2 text-sm text-slate-400">
          Enter your details and the private invite code. An admin will approve
          your account.
        </p>

        {params.error ? (
          <p className="brand-alert-danger mt-4">
            {params.error}
          </p>
        ) : null}

        <SignupForm
          action={signup}
          defaultEmail={params.email ?? ""}
          defaultDisplayName={params.display_name ?? ""}
          defaultLeagueCode={params.league_code ?? ""}
        />

        <p className="mt-4 text-center text-sm text-slate-400">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-emerald-400">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
