import "server-only";

import { cache } from "react";
import { getRequestAuthContext } from "@/utils/app-context";
import { getSelectedLeagueForUser } from "@/utils/leagues";
import { getActiveSeason } from "@/utils/seasons";
import { withServerTiming } from "@/utils/server-timing";
import { getPickerGameweekStatuses } from "@/utils/picker-eligibility";

export const getAppLeagueContext = cache(async () => {
  const { supabase, user, profile } = await getRequestAuthContext();

  if (!user) {
    return {
      supabase,
      user,
      profile,
      selectedLeague: null,
      leagues: [],
      activeSeason: null,
    };
  }

  const { selectedLeague, leagues } = await withServerTiming(
    "legacy.leagues.selected-context",
    () => getSelectedLeagueForUser(supabase, user.id),
    { userId: user.id },
  );
  const { data: activeSeason } = selectedLeague
    ? await withServerTiming(
        "legacy.seasons.active",
        () =>
          getActiveSeason(
            supabase,
            "id, name, status, base_provider, base_competition_code, base_competition_name, base_competition_external_id, provider_season",
            selectedLeague.id,
          ),
        { userId: user.id, leagueId: selectedLeague.id },
      )
    : { data: null };

  return {
    supabase,
    user,
    profile,
    selectedLeague,
    leagues,
    activeSeason,
  };
});

export const getRequestPickerGameweekStatuses = cache(async () => {
  const context = await getAppLeagueContext();

  if (!context.user || !context.activeSeason) {
    return [];
  }

  const userId = context.user.id;
  const activeSeasonId = context.activeSeason.id;

  return withServerTiming(
    "legacy.picker.gameweeks",
    () =>
      getPickerGameweekStatuses({
        supabase: context.supabase,
        userId,
        activeSeasonId,
      }),
    { userId, leagueId: context.selectedLeague?.id },
  );
});

export const getRequestEditablePickerGameweeks = cache(async () => {
  const statuses = await getRequestPickerGameweekStatuses();

  return statuses.filter(
    (gameweek) =>
      gameweek.isUnlocked && !gameweek.isClosed && !gameweek.hasPredictions,
  );
});
