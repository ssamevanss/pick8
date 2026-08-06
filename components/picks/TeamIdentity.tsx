"use client";

import { useState } from "react";

type TeamIdentityProps = {
  name: string;
  crestUrl?: string | null;
  size?: "compact" | "large";
  align?: "left" | "right";
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "FC";
}

export default function TeamIdentity({
  name,
  crestUrl = null,
  size = "compact",
  align = "left",
}: TeamIdentityProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = crestUrl !== null && crestUrl === failedUrl;
  const large = size === "large";

  return (
    <span className={`flex min-w-0 items-center gap-2 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <span className={`grid shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-slate-900 text-amber-200 ${large ? "h-10 w-10 text-xs" : "h-7 w-7 text-[9px]"}`}>
        {crestUrl && !failed ? (
          // The URL is server-synced from Who You Got, never accepted from browser input.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={crestUrl}
            alt={`${name} crest`}
            className="h-full w-full object-contain p-0.5"
            loading="lazy"
            onError={() => setFailedUrl(crestUrl)}
          />
        ) : (
          <span className="font-black" aria-label={`${name} crest unavailable`}>{initials(name)}</span>
        )}
      </span>
      <span className="min-w-0 truncate font-bold text-white" title={name}>{name}</span>
    </span>
  );
}
