"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDefaultLeague } from "@/app/leagues/actions";
import { useToast } from "@/components/toast/ToastProvider";

export default function DefaultLeagueToggle({
  leagueId,
  isDefault,
}: {
  leagueId: string;
  isDefault: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [checked, setChecked] = useState(isDefault);
  const [isPending, startTransition] = useTransition();

  function updateDefault(nextChecked: boolean) {
    const previous = checked;
    setChecked(nextChecked);

    startTransition(async () => {
      const result = await setDefaultLeague(nextChecked ? leagueId : null);

      if (result.error) {
        setChecked(previous);
        showToast({
          title: "Could not save launch preference",
          description: result.error,
          tone: "error",
        });
        return;
      }

      showToast({
        title: nextChecked ? "Default league saved" : "Default league cleared",
      });
      router.refresh();
    });
  }

  return (
    <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-slate-950/45 px-3 py-1.5 text-xs font-bold text-slate-300 transition hover:border-emerald-300/30 hover:text-white">
      <input
        type="checkbox"
        checked={checked}
        disabled={isPending}
        onChange={(event) => updateDefault(event.target.checked)}
        className="h-4 w-4 accent-emerald-300"
      />
      <span>{isPending ? "Saving..." : "Open by default"}</span>
    </label>
  );
}
