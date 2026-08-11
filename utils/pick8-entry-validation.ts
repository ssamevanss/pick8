export const PICK8_CATEGORIES = [
  "home_win",
  "away_win",
  "draw",
  "team_win",
  "team_lose",
  "team_score",
  "clean_sheet",
] as const;

export type Pick8Category = (typeof PICK8_CATEGORIES)[number];
export type Pick8EntryState = "not_started" | "draft" | "submitted";
export type Pick8TeamSide = "home" | "away" | null;
export type Pick8DraftSelection = {
  category: Pick8Category;
  fixtureId: string;
  selectedTeamSide: Pick8TeamSide;
};
export type Pick8DraftChoice = {
  category: Pick8Category | "";
  side: Exclude<Pick8TeamSide, null> | "";
};

const CATEGORY_SIDES: Record<Pick8Category, readonly Pick8TeamSide[]> = {
  home_win: ["home"],
  away_win: ["away"],
  draw: [null],
  team_win: ["home", "away"],
  team_lose: ["home", "away"],
  team_score: ["home", "away"],
  clean_sheet: ["home", "away"],
};

export const PICK8_ENTRY_STATE_LABELS: Record<Pick8EntryState, string> = {
  not_started: "Not started",
  draft: "Draft — Not submitted",
  submitted: "Submitted",
};

export function getPick8EntryState(
  entry: { submitted_at: string | null } | null | undefined,
): Pick8EntryState {
  if (!entry) return "not_started";
  return entry.submitted_at === null ? "draft" : "submitted";
}

export function isPick8Category(value: string): value is Pick8Category {
  return PICK8_CATEGORIES.includes(value as Pick8Category);
}

export function parsePick8DraftSelections(formData: FormData, eligibleFixtureIds: string[]) {
  const selections: Pick8DraftSelection[] = [];

  for (const fixtureId of eligibleFixtureIds) {
    const category = String(formData.get(`fixture_category_${fixtureId}`) ?? "").trim();
    if (!category) continue;
    if (!isPick8Category(category)) return { error: "One or more fixture categories are invalid." } as const;

    const sideValue = String(formData.get(`fixture_side_${fixtureId}`) ?? "").trim();
    const selectedTeamSide: Pick8TeamSide = category === "home_win"
      ? "home"
      : category === "away_win"
        ? "away"
        : category === "draw"
          ? null
          : sideValue === "home" || sideValue === "away"
            ? sideValue
            : null;

    if (!CATEGORY_SIDES[category].includes(selectedTeamSide)) {
      return { error: "Choose a team for every team-based category." } as const;
    }
    selections.push({ category, fixtureId, selectedTeamSide });
  }

  return { selections } as const;
}

export function restorePick8DraftChoices(
  fixtureIds: string[],
  selections: Array<{ category: string; fixtureId: string; selectedTeamSide: string | null }>,
) {
  return Object.fromEntries(fixtureIds.map((fixtureId) => {
    const saved = selections.find((selection) => selection.fixtureId === fixtureId);
    const category = saved && isPick8Category(saved.category) ? saved.category : "";
    const side = saved?.selectedTeamSide === "home" || saved?.selectedTeamSide === "away" ? saved.selectedTeamSide : "";
    return [fixtureId, { category, side }];
  })) as Record<string, Pick8DraftChoice>;
}

export function getDuplicatePick8Categories(
  selections: Array<{ category: Pick8Category }>,
) {
  const counts = new Map<Pick8Category, number>();
  for (const selection of selections) {
    counts.set(selection.category, (counts.get(selection.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([category]) => category);
}

export function getMissingPick8Categories(
  selections: Array<{ category: Pick8Category }>,
) {
  const selected = new Set(selections.map(({ category }) => category));
  return PICK8_CATEGORIES.filter((category) => !selected.has(category));
}

export function isCompletePick8Entry(
  selections: Array<{ category: Pick8Category; fixtureId: string }>,
  totalGoals: number | null,
) {
  return totalGoals !== null &&
    Number.isInteger(totalGoals) &&
    totalGoals >= 0 &&
    totalGoals <= 100 &&
    selections.length === PICK8_CATEGORIES.length &&
    new Set(selections.map(({ fixtureId }) => fixtureId)).size === selections.length &&
    getDuplicatePick8Categories(selections).length === 0 &&
    getMissingPick8Categories(selections).length === 0;
}
