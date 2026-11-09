"use client";

import { useRouter } from "next/navigation";
import { Component, useTransition, type ReactNode } from "react";
import { Spinner } from "@/components/tables/CompetitionLoading";

function CompetitionError({ name, digest, onRetry }: { name: string; digest: string | null; onRetry: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <div role="alert" className="brand-alert-danger space-y-3">
      <p className="font-bold">Couldn&apos;t load {name}.</p>
      <p>Nothing has been changed. This is usually a temporary connection problem; try again.</p>
      {digest ? <p className="text-xs opacity-70">Reference: {digest}</p> : null}
      <button
        type="button"
        className="brand-button-secondary w-full sm:w-auto"
        disabled={isPending}
        onClick={() => startTransition(() => { router.refresh(); onRetry(); })}
      >
        {isPending ? <><Spinner className="mr-2 h-4 w-4" />Retrying…</> : "Try again"}
      </button>
    </div>
  );
}

type Props = { name: string; children: ReactNode };
type State = { error: (Error & { digest?: string }) | null };

/** Keeps the selector usable when one competition fails to load; key it by competition id so switching clears the error. */
export default class CompetitionBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error & { digest?: string }) {
    console.error("[pick8-error-boundary]", { digest: error.digest ?? null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <CompetitionError name={this.props.name} digest={this.state.error.digest ?? null} onRetry={() => this.setState({ error: null })} />;
  }
}
