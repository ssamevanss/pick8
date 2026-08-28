"use client";

import { useEffect } from "react";
import BrandMark from "@/components/brand/BrandMark";

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[pick8-error-boundary]", {
      digest: error.digest ?? null,
    });
  }, [error.digest]);

  return (
    <main className="app-surface flex min-h-screen items-center justify-center px-4 py-8 text-white">
      <section className="brand-card w-full max-w-lg p-6 text-center sm:p-8">
        <BrandMark />
        <p className="brand-eyebrow mt-6">Temporary connection problem</p>
        <h1 className="mt-2 text-3xl font-black text-white">
          Pick8 couldn&apos;t load this page
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Your session, picks, and account details have not been cleared. This
          is usually temporary, so please try the request again.
        </p>
        <button
          type="button"
          className="brand-button-primary mt-6 w-full"
          onClick={() => unstable_retry()}
        >
          Try again
        </button>
      </section>
    </main>
  );
}
