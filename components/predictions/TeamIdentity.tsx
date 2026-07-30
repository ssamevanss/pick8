import Image from "next/image";
import { getTeamAsset, getTeamShortLabel } from "@/utils/team-assets";

type TeamIdentityProps = {
  teamName: string;
  teamCode?: string | null;
  crestUrl?: string | null;
  positionLabel?: string | null;
  align?: "left" | "right";
  compact?: boolean;
};

export default function TeamIdentity({
  teamName,
  teamCode = null,
  crestUrl = null,
  positionLabel = null,
  align = "left",
  compact = false,
}: TeamIdentityProps) {
  const asset = getTeamAsset({ teamName, teamCode, crestUrl });
  const mobileLabel = getTeamShortLabel(teamName);
  const reverse = align === "right";

  return (
    <span
      className={`flex min-w-0 items-center gap-2 ${
        reverse ? "flex-row-reverse text-right" : ""
      }`}
    >
      <span
        className={`grid shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-slate-900 ${
          compact ? "h-7 w-7" : "h-9 w-9"
        }`}
        aria-hidden="true"
      >
        {asset.assetPath && asset.isRemote ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.assetPath}
            alt=""
            width={compact ? 28 : 36}
            height={compact ? 28 : 36}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : asset.assetPath ? (
          <Image
            src={asset.assetPath}
            alt=""
            width={compact ? 28 : 36}
            height={compact ? 28 : 36}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span
            className={`text-[10px] font-black ${
              asset.tone === "club" ? "text-amber-200" : "text-emerald-200"
            }`}
          >
            {asset.initials}
          </span>
        )}
      </span>
      <span className="min-w-0" title={teamName}>
        <span
          className={`block font-semibold leading-tight ${
            compact ? "text-xs min-[380px]:text-sm" : "truncate"
          }`}
        >
          <span className="sm:hidden">{mobileLabel}</span>
          <span className="hidden sm:inline">{teamName}</span>
        </span>
        {positionLabel ? (
          <span className="mt-0.5 block text-[10px] font-black uppercase tracking-wide text-amber-200">
            {positionLabel}
          </span>
        ) : null}
      </span>
    </span>
  );
}
