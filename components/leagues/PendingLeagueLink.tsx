"use client";

import Link from "next/link";
import { useState, type MouseEvent } from "react";

export default function PendingLeagueLink({
  href,
  idleLabel,
  pendingLabel,
  className,
}: {
  href: string;
  idleLabel: string;
  pendingLabel: string;
  className: string;
}) {
  const [pending, setPending] = useState(false);

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
    <Link
      href={href}
      aria-busy={pending}
      aria-disabled={pending}
      onClick={handleClick}
      className={`${className} ${pending ? "pointer-events-none opacity-70" : ""}`}
    >
      {pending ? pendingLabel : idleLabel}
    </Link>
  );
}
