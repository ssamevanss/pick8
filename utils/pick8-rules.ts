export const PICK8_RULES_VERSION_1 = 1 as const;
export const PICK8_RULES_VERSION_2 = 2 as const;

export type Pick8RulesVersion =
  | typeof PICK8_RULES_VERSION_1
  | typeof PICK8_RULES_VERSION_2;

export const PICK8_V1_CATEGORIES = [
  "home_win",
  "away_win",
  "draw",
  "team_win",
  "team_lose",
  "team_score",
  "clean_sheet",
] as const;

export const PICK8_V2_CATEGORIES = [
  ...PICK8_V1_CATEGORIES,
  "btts",
] as const;

export type Pick8Category = (typeof PICK8_V2_CATEGORIES)[number];
export type Pick8TeamSide = "home" | "away" | null;

export const PICK8_CATEGORY_METADATA: Record<
  Pick8Category,
  {
    label: string;
    needsTeam: boolean;
    allowedSides: readonly Pick8TeamSide[];
  }
> = {
  home_win: { label: "Home Winner", needsTeam: false, allowedSides: ["home"] },
  away_win: { label: "Away Winner", needsTeam: false, allowedSides: ["away"] },
  draw: { label: "Draw", needsTeam: false, allowedSides: [null] },
  team_win: { label: "Team to Win", needsTeam: true, allowedSides: ["home", "away"] },
  team_lose: { label: "Team to Lose", needsTeam: true, allowedSides: ["home", "away"] },
  team_score: { label: "Team to Score", needsTeam: true, allowedSides: ["home", "away"] },
  clean_sheet: { label: "Clean Sheet", needsTeam: true, allowedSides: ["home", "away"] },
  btts: { label: "Both Teams To Score", needsTeam: false, allowedSides: [null] },
};

export function normalizePick8RulesVersion(value: number | null | undefined): Pick8RulesVersion {
  return value === PICK8_RULES_VERSION_2
    ? PICK8_RULES_VERSION_2
    : PICK8_RULES_VERSION_1;
}

export function getPick8CategoriesForRulesVersion(
  value: number | null | undefined,
): readonly Pick8Category[] {
  return normalizePick8RulesVersion(value) === PICK8_RULES_VERSION_2
    ? PICK8_V2_CATEGORIES
    : PICK8_V1_CATEGORIES;
}

export function getPick8Rules(value: number | null | undefined) {
  const version = normalizePick8RulesVersion(value);
  const categories = getPick8CategoriesForRulesVersion(version);
  return {
    version,
    categories,
    fixtureSelectionCount: categories.length,
    totalSelectionCount: categories.length + 1,
  };
}

export function isPick8Category(value: string): value is Pick8Category {
  return PICK8_V2_CATEGORIES.includes(value as Pick8Category);
}

export function isPick8CategoryForRulesVersion(
  value: string,
  rulesVersion: number | null | undefined,
): value is Pick8Category {
  return getPick8CategoriesForRulesVersion(rulesVersion).includes(value as Pick8Category);
}
