"use server";

import { getRequestAuthContext } from "@/utils/app-context";
import {
  FixtureSyncError,
  syncWhoYouGotFixtures,
  type FixtureSyncSummary,
} from "@/utils/who-you-got-fixture-sync";

export type FixtureSyncActionState = {
  ok: boolean;
  message: string;
  summary?: FixtureSyncSummary;
};

export async function syncFixturesAction(
  _previousState: FixtureSyncActionState,
  formData: FormData,
): Promise<FixtureSyncActionState> {
  const { user, profile } = await getRequestAuthContext();
  if (!user || !profile?.is_admin || !profile.is_active) {
    return { ok: false, message: "Active administrator access is required." };
  }

  const season = Number(String(formData.get("season") ?? "").trim());
  const matchday = Number(String(formData.get("matchday") ?? "").trim());
  try {
    const summary = await syncWhoYouGotFixtures({ season, matchday });
    return {
      ok: true,
      message: `Season ${summary.season}/${String((summary.season + 1) % 100).padStart(2, "0")} matchday ${summary.matchday} synced.`,
      summary,
    };
  } catch (error) {
    if (error instanceof FixtureSyncError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "Fixture sync failed unexpectedly." };
  }
}
