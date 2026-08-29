import "server-only";

import {
  calculateCompletedMatchdayGoalTotal,
  isMatchdayReadyForFinalScoring,
} from "@/utils/pick8-scoring";
import {
  hasFixtureKickedOff,
  isPick8SelectionVisible,
} from "@/utils/pick8-fixture-state";
import type {
  BreakdownEntry,
  BreakdownFixture,
  BreakdownMatchday,
  BreakdownPlayer,
  BreakdownProfile,
  BreakdownSelection,
} from "@/utils/pick8-breakdown-types";

export type {
  BreakdownEntry,
  BreakdownFixture,
  BreakdownMatchday,
  BreakdownPlayer,
  BreakdownProfile,
  BreakdownSelection,
} from "@/utils/pick8-breakdown-types";

export function isMatchdayVisibleToAll(
  matchday: BreakdownMatchday,
  fixtures: BreakdownFixture[],
  now: number,
) {
  return (
    ["locked", "scoring", "completed"].includes(matchday.status) ||
    fixtures.some((fixture) => hasFixtureKickedOff(fixture.kickoff_at, now))
  );
}

export function buildMatchdayBreakdown({
  matchday,
  profiles,
  entries,
  selections,
  fixtures,
  viewerId,
  now,
  includeAdminDrafts = false,
}: {
  matchday: BreakdownMatchday;
  profiles: BreakdownProfile[];
  entries: BreakdownEntry[];
  selections: BreakdownSelection[];
  fixtures: BreakdownFixture[];
  viewerId: string;
  now: number;
  includeAdminDrafts?: boolean;
}) {
  const visibleToAll = isMatchdayVisibleToAll(matchday, fixtures, now);
  const finalReady = isMatchdayReadyForFinalScoring(fixtures);
  const actualGoals = calculateCompletedMatchdayGoalTotal(fixtures);
  const visibleProfiles = includeAdminDrafts || visibleToAll
    ? profiles
    : profiles.filter((profile) => profile.id === viewerId);
  const players: BreakdownPlayer[] = visibleProfiles.map((player) => {
    const namedPlayer = {
      ...player,
      display_name: player.display_name.trim() || "Player",
    };
    const candidate = entries.find(
      (entry) => entry.matchday_id === matchday.id && entry.user_id === player.id,
    );
    const entry = includeAdminDrafts || player.id === viewerId
      ? candidate ?? null
      : candidate?.submitted_at
        ? candidate
        : null;
    const entrySelections = entry
      ? selections.filter((selection) => {
          if (selection.entry_id !== entry.id) return false;
          if (player.id === viewerId || includeAdminDrafts) return true;
          const fixture = fixtures.find((item) => item.id === selection.fixture_id);
          return fixture ? isPick8SelectionVisible({
            viewerId,
            ownerId: player.id,
            submittedAt: entry.submitted_at,
            kickoffAt: fixture.kickoff_at,
            now,
          }) : false;
        })
      : [];
    const selectionPoints = entrySelections.reduce(
      (total, selection) => total + (selection.points_awarded ?? 0),
      0,
    );
    return {
      player: namedPlayer,
      entry,
      selections: entrySelections,
      totalGoalsPoints:
        entry?.calculated_score === null || entry?.calculated_score === undefined
          ? null
          : entry.calculated_score - selectionPoints,
    };
  });
  const hasFinalScores = players.some(
    ({ entry }) => entry?.calculated_score !== null && entry?.calculated_score !== undefined,
  );
  players.sort((a, b) => {
    if (hasFinalScores) {
      if (a.entry?.calculated_score === null || a.entry?.calculated_score === undefined) return 1;
      if (b.entry?.calculated_score === null || b.entry?.calculated_score === undefined) return -1;
      return b.entry.calculated_score - a.entry.calculated_score ||
        a.player.display_name.localeCompare(b.player.display_name);
    }
    return a.player.display_name.localeCompare(b.player.display_name);
  });
  return { visibleToAll, finalReady, actualGoals, players };
}
