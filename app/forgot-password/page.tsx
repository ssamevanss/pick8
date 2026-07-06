import Link from "next/link";
import BrandMark from "@/components/brand/BrandMark";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";
import { requestPasswordReset } from "./actions";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; email?: string; sent?: string }>;
}) {
  const params = searchParams ? await searchParams : {};

  return (
    <main className="app-surface flex min-h-screen items-center justify-center px-4 py-8 text-white">
      <div className="brand-card w-full max-w-md p-6 sm:p-8">
        <BrandMark />

        <h1 className="mt-4 text-3xl font-bold">Reset your password</h1>

        <p className="mt-2 text-sm text-slate-400">
          Enter your email and we will send a reset link if the account exists.
        </p>

        {params.error ? (
          <p className="brand-alert-danger mt-4">{params.error}</p>
        ) : null}

        {params.sent ? (
          <p className="brand-alert-success mt-4">
            If that email is registered, a password reset link has been sent.
          </p>
        ) : null}

        <ForgotPasswordForm
          action={requestPasswordReset}
          defaultEmail={params.email ?? ""}
        />

        <p className="mt-4 text-center text-sm text-slate-400">
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-emerald-400">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
