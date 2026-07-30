"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type EditFixturesLinkProps = {
  href: string;
};

export default function EditFixturesLink({ href }: EditFixturesLinkProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      aria-busy={isPending}
      onClick={() => {
        startTransition(() => {
          router.push(href);
        });
      }}
      className="brand-button-primary inline-flex w-fit items-center justify-center gap-2 shadow-lg shadow-emerald-950/20 disabled:cursor-wait disabled:opacity-70"
    >
      {isPending ? (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-950/30 border-t-slate-950"
          aria-hidden="true"
        />
      ) : null}
      {isPending ? "Opening editor..." : "Edit fixtures"}
    </button>
  );
}
