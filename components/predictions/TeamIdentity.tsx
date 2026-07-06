import Image from "next/image";
import { getTeamAsset } from "@/utils/team-assets";

type TeamIdentityProps = {
  teamName: string;
  align?: "left" | "right";
  compact?: boolean;
};

export default function TeamIdentity({
  teamName,
  align = "left",
  compact = false,
}: TeamIdentityProps) {
  const asset = getTeamAsset(teamName);
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
        {asset.assetPath ? (
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
      <span className="min-w-0 truncate font-semibold">{teamName}</span>
    </span>
  );
}
