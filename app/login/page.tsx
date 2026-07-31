import Link from "next/link";
import BrandMark from "@/components/brand/BrandMark";
import LoginForm from "@/components/auth/LoginForm";
import { login } from "./actions";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

function safeNext(value: string | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; email?: string; next?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const next = safeNext(params.next);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(next || "/leagues/launch");
  }

  return (
    <main className="app-surface flex min-h-screen items-center justify-center px-4 py-8 text-white">
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

        <LoginForm
          action={login}
          defaultEmail={params.email ?? ""}
          next={next}
        />

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
