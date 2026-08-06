import Link from "next/link";
import BrandMark from "@/components/brand/BrandMark";
import SignupForm from "@/components/auth/SignupForm";
import { signup } from "./actions";

export default async function SignupPage({ searchParams }: { searchParams?: Promise<{ error?: string; display_name?: string; email?: string; check_email?: string }> }) {
  const params = searchParams ? await searchParams : {};
  return (
    <main className="app-surface flex min-h-screen items-center justify-center px-4 py-8 text-white">
      <div className="brand-card w-full max-w-md p-6 text-center sm:p-8">
        <BrandMark centered />

        <h1 className="mt-4 text-3xl font-bold">{params.check_email ? "Check your email" : "Create your account"}</h1>
        {params.check_email ? <><p className="mt-3 text-sm leading-6 text-slate-300">Use the verification link in your email before signing in to Pick8.</p><Link href="/login" className="brand-button-primary mt-6 w-full">Back to sign in</Link></> : <><p className="mt-2 text-sm text-slate-400">Join the private Pick8 group with its registration code.</p>{params.error ? <p className="brand-alert-danger mt-4 text-left">{params.error}</p> : null}<SignupForm action={signup} defaultDisplayName={params.display_name} defaultEmail={params.email} /><p className="mt-4 text-center text-sm text-slate-400">Already registered? <Link href="/login" className="font-semibold text-emerald-300">Sign in</Link></p></>}
      </div>
    </main>
  );
}
