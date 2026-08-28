export type Pick8EntryIntent = "draft" | "submit" | "save_changes";

export type IntendedPick8Entry = {
  intent: Pick8EntryIntent;
  totalGoals: number | null;
  selections: Array<{
    category: string;
    fixtureId: string;
    selectedTeamSide: string | null;
  }>;
};

export type PersistedPick8Entry = {
  submittedAt: string | null;
  totalGoals: number | null;
  selections: Array<{
    category: string;
    fixtureId: string;
    selectedTeamSide: string | null;
  }>;
};

function selectionKey(selection: IntendedPick8Entry["selections"][number]) {
  return [
    selection.category,
    selection.fixtureId,
    selection.selectedTeamSide ?? "",
  ].join("\u0000");
}

export function persistedEntryMatchesIntent(
  intended: IntendedPick8Entry,
  persisted: PersistedPick8Entry,
) {
  const submissionStateMatches = intended.intent === "draft"
    ? persisted.submittedAt === null
    : persisted.submittedAt !== null;
  if (!submissionStateMatches || intended.totalGoals !== persisted.totalGoals) {
    return false;
  }

  const intendedSelections = intended.selections.map(selectionKey).sort();
  const persistedSelections = persisted.selections.map(selectionKey).sort();
  return intendedSelections.length === persistedSelections.length &&
    intendedSelections.every((value, index) => value === persistedSelections[index]);
}

export type Pick8MutationResolution<T, E> =
  | { kind: "success"; value: T; reconciled: false }
  | { kind: "success"; value: T; reconciled: true }
  | { kind: "failure"; error: E }
  | { kind: "unknown"; error: E };

export async function resolvePick8Mutation<T, E>({
  mutate,
  isUncertainError,
  reconcile,
}: {
  mutate: () => Promise<{ data: T | null; error: E | null }>;
  isUncertainError: (error: E) => boolean;
  reconcile: () => Promise<T | null>;
}): Promise<Pick8MutationResolution<T, E>> {
  const result = await mutate();
  if (!result.error) {
    return { kind: "success", value: result.data as T, reconciled: false };
  }
  if (!isUncertainError(result.error)) {
    return { kind: "failure", error: result.error };
  }

  const reconciled = await reconcile();
  return reconciled === null
    ? { kind: "unknown", error: result.error }
    : { kind: "success", value: reconciled, reconciled: true };
}
