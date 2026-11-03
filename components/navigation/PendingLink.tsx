"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, useRef, type MouseEvent, type ReactNode, type RefObject } from "react";

type PendingLinkProps = {
  href: string;
  children: ReactNode;
  // Shown with a spinner while the navigation is in flight, e.g. "Opening breakdown…".
  pendingLabel: string;
  className?: string;
};

// Rendered inside <Link> because useLinkStatus only reports the status of its parent link. Next resets
// `pending` itself when the navigation commits, fails or is superseded, so no timer is needed.
function LinkContent({
  children,
  pendingLabel,
  pendingRef,
}: {
  children: ReactNode;
  pendingLabel: string;
  pendingRef: RefObject<boolean>;
}) {
  const { pending } = useLinkStatus();

  useEffect(() => {
    pendingRef.current = pending;
    return () => {
      pendingRef.current = false;
    };
  }, [pending, pendingRef]);

  return (
    <>
      {pending ? (
        <span data-pending="" aria-hidden="true" className="inline-flex items-center gap-2">
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-300/30 border-t-emerald-200"
          />
          {pendingLabel}
        </span>
      ) : (
        children
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {pending ? pendingLabel : ""}
      </span>
    </>
  );
}

export default function PendingLink({ href, children, pendingLabel, className = "" }: PendingLinkProps) {
  const pendingRef = useRef(false);

  // A second click or Enter while the first navigation is pending must not start another one.
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (pendingRef.current) event.preventDefault();
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      className={`${className} has-[[data-pending]]:cursor-wait has-[[data-pending]]:text-emerald-100`}
    >
      <LinkContent pendingLabel={pendingLabel} pendingRef={pendingRef}>
        {children}
      </LinkContent>
    </Link>
  );
}
