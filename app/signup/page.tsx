import Link from "next/link";
import BrandMark from "@/components/brand/BrandMark";

export default function SignupPage() {
  return (
    <main className="app-surface flex min-h-screen items-center justify-center px-4 py-8 text-white">
      <div className="brand-card w-full max-w-md p-6 text-center sm:p-8">
        <BrandMark centered />

        <h1 className="mt-4 text-3xl font-bold">Private access</h1>

        <p className="mt-2 text-sm text-slate-400">
          Accounts are created by the Pick8 administrator.
        </p>

        <Link href="/login" className="brand-button-primary mt-6 w-full">
          Sign in
        </Link>
      </div>
    </main>
  );
}
