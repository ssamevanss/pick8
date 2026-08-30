import type {
  Pick8Category,
  Pick8TeamSide,
} from "./pick8-entry-validation";

const PICK8_CATEGORY_DISPLAY_ORDER: readonly Pick8Category[] = [
  "home_win",
  "away_win",
  "draw",
  "team_win",
  "team_lose",
  "team_score",
  "clean_sheet",
];

export const PICK8_CATEGORY_LABELS: Record<Pick8Category, string> = {
  home_win: "Home Winner",
  away_win: "Away Winner",
  draw: "Draw",
  team_win: "Team to Win",
  team_lose: "Team to Lose",
  team_score: "Team to Score",
  clean_sheet: "Clean Sheet",
};

export function pick8CategoryDisplayOrder(category: string) {
  const index = PICK8_CATEGORY_DISPLAY_ORDER.indexOf(category as Pick8Category);
  return index === -1 ? PICK8_CATEGORY_DISPLAY_ORDER.length : index;
}

export function canonicalPick8SelectionSide(
  category: string,
  selectedTeamSide: string | null,
): Pick8TeamSide {
  if (category === "home_win") return "home";
  if (category === "away_win") return "away";
  if (category === "draw") return null;
  return selectedTeamSide === "home" || selectedTeamSide === "away"
    ? selectedTeamSide
    : null;
}

export function pick8SelectionIdentity(
  category: string,
  selectedTeamSide: string | null,
) {
  return `${category}:${canonicalPick8SelectionSide(category, selectedTeamSide) ?? "none"}`;
}

type Pick8DisplayFixture = {
  homeTeamName: string;
  awayTeamName: string;
};

export function formatPick8FixtureSelection(
  category: string,
  selectedTeamSide: string | null,
  fixture: Pick8DisplayFixture,
) {
  const side = canonicalPick8SelectionSide(category, selectedTeamSide);
  const selectedTeam = side === "home"
    ? fixture.homeTeamName
    : side === "away"
      ? fixture.awayTeamName
      : null;
  const categoryLabel = PICK8_CATEGORY_LABELS[category as Pick8Category] ?? category;

  if (category === "draw") return "Draw";
  if (category === "home_win") return `${categoryLabel} — ${fixture.homeTeamName}`;
  if (category === "away_win") return `${categoryLabel} — ${fixture.awayTeamName}`;
  if (!selectedTeam) return categoryLabel;
  if (category === "team_win") return `${selectedTeam} to Win — ${categoryLabel}`;
  if (category === "team_lose") return `${selectedTeam} to Lose`;
  if (category === "team_score") return `${selectedTeam} to Score`;
  if (category === "clean_sheet") return `${selectedTeam} Clean Sheet`;
  return `${categoryLabel} — ${selectedTeam}`;
}

export type FixturePickGroupInput = {
  selectionId: string;
  playerId: string;
  playerName: string;
  category: string;
  selectedTeamSide: string | null;
  displayedPoints: number | null;
};

export type FixturePickGroup = {
  key: string;
  category: string;
  selectedTeamSide: "home" | "away" | null;
  displayedPoints: number | null;
  players: Array<{
    id: string;
    name: string;
    selectionId: string;
  }>;
};

export function groupFixturePicks(
  picks: FixturePickGroupInput[],
): FixturePickGroup[] {
  const groups = new Map<string, FixturePickGroup>();

  for (const pick of picks) {
    const key = pick8SelectionIdentity(pick.category, pick.selectedTeamSide);
    const existing = groups.get(key);
    if (existing) {
      existing.players.push({
        id: pick.playerId,
        name: pick.playerName,
        selectionId: pick.selectionId,
      });
      continue;
    }

    groups.set(key, {
      key,
      category: pick.category,
      selectedTeamSide: canonicalPick8SelectionSide(
        pick.category,
        pick.selectedTeamSide,
      ),
      displayedPoints: pick.displayedPoints,
      players: [{
        id: pick.playerId,
        name: pick.playerName,
        selectionId: pick.selectionId,
      }],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      players: group.players.sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
        left.id.localeCompare(right.id),
      ),
    }))
    .sort((left, right) => {
      if (left.displayedPoints === null && right.displayedPoints !== null) return 1;
      if (left.displayedPoints !== null && right.displayedPoints === null) return -1;
      const pointsDifference = (right.displayedPoints ?? 0) - (left.displayedPoints ?? 0);
      return pointsDifference ||
        pick8CategoryDisplayOrder(left.category) - pick8CategoryDisplayOrder(right.category) ||
        left.key.localeCompare(right.key);
    });
}
