import Link from "next/link";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import { createClient } from "@/utils/supabase/server";
import { updatePassword } from "./actions";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; updated?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const canReset = Boolean(user);

  return (
    <main className="app-surface flex min-h-screen items-center justify-center px-4 py-8 text-white">
      <div className="brand-card w-full max-w-md p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-400 text-xl font-black text-slate-950">
            W
          </div>
          <div>
            <p className="text-lg font-black tracking-tight">Who You Got?</p>
            <p className="brand-eyebrow">Password reset</p>
          </div>
        </div>

        <h1 className="mt-4 text-3xl font-bold">Choose a new password</h1>

        {params.error ? (
          <p className="brand-alert-danger mt-4">{params.error}</p>
        ) : null}

        {params.updated ? (
          <>
            <p className="brand-alert-success mt-4">
              Your password has been updated.
            </p>
            <Link href="/dashboard" className="brand-button-primary mt-6 w-full">
              Continue to league
            </Link>
          </>
        ) : canReset ? (
          <>
            <p className="mt-2 text-sm text-slate-400">
              Enter a new password for your account.
            </p>
            <ResetPasswordForm action={updatePassword} />
          </>
        ) : (
          <>
            <p className="brand-alert-warning mt-4">
              Open the latest reset link from your email to choose a new
              password.
            </p>
            <Link
              href="/forgot-password"
              className="brand-button-primary mt-6 w-full"
            >
              Request a new reset link
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
