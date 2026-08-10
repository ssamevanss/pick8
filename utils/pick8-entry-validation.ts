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
