"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

type PendingLinkProps = {
  href: string;
  children: ReactNode;
  pendingChildren?: ReactNode;
  className?: string;
};

export default function PendingLink({
  href,
  children,
  pendingChildren,
  className = "",
}: PendingLinkProps) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!pending) {
      return;
    }

    const timeout = window.setTimeout(() => setPending(false), 6000);

    return () => window.clearTimeout(timeout);
  }, [pending]);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }

    setPending(true);
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      aria-busy={pending}
      className={`${className} ${
        pending ? "cursor-wait opacity-70" : ""
      }`}
    >
      {pending ? pendingChildren ?? children : children}
    </a>
  );
}
