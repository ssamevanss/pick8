import {
  getPick8CategoriesForRulesVersion,
  isPick8Category,
  isPick8CategoryForRulesVersion,
  PICK8_CATEGORY_METADATA,
  type Pick8Category,
  type Pick8RulesVersion,
  type Pick8TeamSide,
} from "./pick8-rules.ts";

export type { Pick8Category, Pick8RulesVersion, Pick8TeamSide } from "./pick8-rules.ts";
export type Pick8EntryState = "not_started" | "draft" | "submitted";
export type Pick8DraftSelection = {
  category: Pick8Category;
  fixtureId: string;
  selectedTeamSide: Pick8TeamSide;
};
export type Pick8DraftChoice = {
  category: Pick8Category | "";
  side: Exclude<Pick8TeamSide, null> | "";
};

export function buildPick8EditorSnapshot(
  fixtureIds: string[],
  selections: Array<{ category: string; fixtureId: string; selectedTeamSide: string | null }>,
  totalGoals: number | null,
  rulesVersion: Pick8RulesVersion = 1,
) {
  return {
    choices: restorePick8DraftChoices(fixtureIds, selections, rulesVersion),
    totalGoals: totalGoals === null ? "" : String(totalGoals),
  };
}

export function copyPick8EditorSnapshot(snapshot: {
  choices: Record<string, Pick8DraftChoice>;
  totalGoals: string;
}) {
  return {
    choices: Object.fromEntries(
      Object.entries(snapshot.choices).map(([fixtureId, choice]) => [fixtureId, { ...choice }]),
    ) as Record<string, Pick8DraftChoice>,
    totalGoals: snapshot.totalGoals,
  };
}

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

export { isPick8Category };

export function parsePick8DraftSelections(
  formData: FormData,
  eligibleFixtureIds: string[],
  rulesVersion: Pick8RulesVersion = 1,
) {
  const selections: Pick8DraftSelection[] = [];

  for (const fixtureId of eligibleFixtureIds) {
    const category = String(formData.get(`fixture_category_${fixtureId}`) ?? "").trim();
    if (!category) continue;
    if (!isPick8CategoryForRulesVersion(category, rulesVersion)) {
      return { error: "One or more fixture categories are invalid for this Matchday." } as const;
    }

    const sideValue = String(formData.get(`fixture_side_${fixtureId}`) ?? "").trim();
    const selectedTeamSide: Pick8TeamSide = category === "home_win"
      ? "home"
      : category === "away_win"
        ? "away"
        : category === "draw" || category === "btts"
          ? null
          : sideValue === "home" || sideValue === "away"
            ? sideValue
            : null;

    if (!PICK8_CATEGORY_METADATA[category].allowedSides.includes(selectedTeamSide)) {
      return { error: "Choose a team for every team-based category." } as const;
    }
    selections.push({ category, fixtureId, selectedTeamSide });
  }

  return { selections } as const;
}

export function restorePick8DraftChoices(
  fixtureIds: string[],
  selections: Array<{ category: string; fixtureId: string; selectedTeamSide: string | null }>,
  rulesVersion: Pick8RulesVersion = 1,
) {
  return Object.fromEntries(fixtureIds.map((fixtureId) => {
    const saved = selections.find((selection) => selection.fixtureId === fixtureId);
    const category = saved && isPick8CategoryForRulesVersion(saved.category, rulesVersion)
      ? saved.category
      : "";
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
  rulesVersion: Pick8RulesVersion = 1,
) {
  const selected = new Set(selections.map(({ category }) => category));
  return getPick8CategoriesForRulesVersion(rulesVersion).filter((category) => !selected.has(category));
}

export function isCompletePick8Entry(
  selections: Array<{ category: Pick8Category; fixtureId: string }>,
  totalGoals: number | null,
  rulesVersion: Pick8RulesVersion = 1,
) {
  const requiredCategories = getPick8CategoriesForRulesVersion(rulesVersion);
  return totalGoals !== null &&
    Number.isInteger(totalGoals) &&
    totalGoals >= 0 &&
    totalGoals <= 100 &&
    selections.length === requiredCategories.length &&
    new Set(selections.map(({ fixtureId }) => fixtureId)).size === selections.length &&
    getDuplicatePick8Categories(selections).length === 0 &&
    getMissingPick8Categories(selections, rulesVersion).length === 0;
}
