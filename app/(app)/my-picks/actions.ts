"use server";

import { revalidatePath } from "next/cache";
import { getRequestAuthContext } from "@/utils/app-context";
import {
  earliestFixtureKickoff,
  isInitialPick8EntryWindowOpen,
  isFixtureSelectionEditable,
} from "@/utils/pick8-fixture-state";
import {
  getDuplicatePick8Categories,
  getMissingPick8Categories,
  isPick8Category,
  parsePick8DraftSelections,
  PICK8_CATEGORIES,
  type Pick8DraftSelection,
} from "@/utils/pick8-entry-validation";

const REQUIRED_CATEGORIES = PICK8_CATEGORIES;

export type PickEntryActionState = {
  ok: boolean;
  message: string;
  intent?: "draft" | "submit" | "save_changes";
  submittedAt?: string | null;
};

function failure(message: string): PickEntryActionState {
  return { ok: false, message };
}

function logPick8DatabaseError(
  stage: string,
  context: Record<string, unknown>,
  error: { code?: string; message: string; details?: string | null; hint?: string | null },
) {
  console.error(`Pick8 database error during ${stage}`, {
    ...context,
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    },
  });
}

export async function savePickEntry(
  _previousState: PickEntryActionState,
  formData: FormData,
): Promise<PickEntryActionState> {
  const { supabase, user, profile } = await getRequestAuthContext();
  if (!user || !profile?.is_active) {
    return failure("An active Pick8 account is required.");
  }

  const rawIntent = String(formData.get("intent") ?? "draft");
  const intent = rawIntent === "submit"
    ? "submit"
    : rawIntent === "save_changes"
      ? "save_changes"
      : "draft";
  const matchdayId = String(formData.get("matchday_id") ?? "").trim();
  if (!matchdayId) return failure("The matchday is missing.");

  const { data: matchday, error: matchdayError } = await supabase
    .from("matchdays")
    .select("id, status, locks_at, seasons!inner(is_active)")
    .eq("id", matchdayId)
    .eq("seasons.is_active", true)
    .maybeSingle();
  if (matchdayError) return failure("The matchday could not be verified.");
  if (!matchday) return failure("This matchday is not in the active season.");

  const requestNow = Date.now();
  const { data: eligibleFixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("id, kickoff_at, status")
    .eq("matchday_id", matchdayId);
  if (fixturesError) return failure("Fixtures could not be verified.");
  const effectiveLocksAt = earliestFixtureKickoff(eligibleFixtures ?? []) ?? matchday.locks_at;
  const editableFixtureIds = (eligibleFixtures ?? [])
    .filter((fixture) => isFixtureSelectionEditable(fixture, requestNow))
    .map((fixture) => fixture.id);
  const nowIso = new Date(requestNow).toISOString();
  const { data: existingEntry, error: entryReadError } = await supabase
    .from("entries")
    .select("id, submitted_at, total_goals_prediction")
    .eq("user_id", user.id)
    .eq("matchday_id", matchdayId)
    .maybeSingle();
  if (entryReadError) return failure("Your entry could not be loaded.");
  const initialWindowOpen = isInitialPick8EntryWindowOpen(matchday.status, effectiveLocksAt, requestNow);
  if (!existingEntry?.submitted_at && !initialWindowOpen) {
    return failure("The submission deadline has passed. Existing submitted picks remain viewable.");
  }
  if (intent === "save_changes" && !existingEntry?.submitted_at) {
    return failure("There is no submitted entry to update.");
  }
  if (intent === "draft" && existingEntry?.submitted_at) {
    return failure(
      "This entry is already submitted. Use Save Changes to keep it submitted.",
    );
  }
  if (intent === "submit" && existingEntry?.submitted_at) {
    return failure("This entry is already submitted. Enter edit mode to change future fixtures.");
  }
  if (intent === "save_changes" && editableFixtureIds.length === 0) {
    return failure("Every fixture has kicked off; this submission is now read-only.");
  }

  let entryId = existingEntry?.id;
  const { data: existingSelections, error: selectionsReadError } = entryId
    ? await supabase
        .from("entry_selections")
        .select("id, category, fixture_id, selected_team_side")
        .eq("entry_id", entryId)
    : { data: [], error: null };
  if (selectionsReadError) return failure("Your saved selections could not be loaded.");

  const parsed = parsePick8DraftSelections(formData, editableFixtureIds);
  if ("error" in parsed) {
    return failure(parsed.error ?? "One or more selections are malformed.");
  }
  const editableFixtureIdSet = new Set(editableFixtureIds);
  const preservedSelections: Pick8DraftSelection[] = (existingSelections ?? [])
    .filter((selection) => !editableFixtureIdSet.has(selection.fixture_id))
    .filter((selection) => isPick8Category(selection.category))
    .map((selection) => ({
      category: selection.category as Pick8DraftSelection["category"],
      fixtureId: selection.fixture_id,
      selectedTeamSide: selection.selected_team_side as Pick8DraftSelection["selectedTeamSide"],
    }));
  const mergedSelections = [...preservedSelections, ...parsed.selections];
  if (intent !== "draft" && getDuplicatePick8Categories(mergedSelections).length) {
    return failure("Each prediction category can only be used once, including locked fixtures.");
  }

  const totalGoalsRaw = String(formData.get("total_goals") ?? "").trim();
  const submittedTotalGoals = totalGoalsRaw === "" ? null : Number(totalGoalsRaw);
  const totalGoals = initialWindowOpen
    ? submittedTotalGoals
    : existingEntry?.total_goals_prediction ?? null;
  if (totalGoals !== null && (!Number.isInteger(totalGoals) || totalGoals < 0 || totalGoals > 100)) {
    return failure("Total Goals must be a whole number between 0 and 100.");
  }
  if (intent === "submit" || intent === "save_changes") {
    const missingCategories = getMissingPick8Categories(mergedSelections);
    if (totalGoals === null || mergedSelections.length !== REQUIRED_CATEGORIES.length || missingCategories.length) {
      const missing = [
        ...missingCategories.map((category) => category.replaceAll("_", " ")),
        ...(totalGoals === null ? ["total goals"] : []),
      ];
      return failure(`Incomplete entry. Missing: ${missing.join(", ")}.`);
    }
  }

  if (!entryId) {
    // Do not request INSERT ... RETURNING here. The new row is permitted by
    // the INSERT policy, but policy helpers that query entries cannot see that
    // same row through an MVCC subquery until the following statement.
    const { error } = await supabase
      .from("entries")
      .insert({
        user_id: user.id,
        matchday_id: matchdayId,
        total_goals_prediction: totalGoals,
        submitted_at: null,
      });
    if (error) {
      logPick8DatabaseError("draft entry creation", { matchdayId, userId: user.id }, error);
      return failure("Your draft could not be created. Your selections are still shown; please try again.");
    }

    const { data, error: createdEntryReadError } = await supabase
      .from("entries")
      .select("id")
      .eq("user_id", user.id)
      .eq("matchday_id", matchdayId)
      .single();
    if (createdEntryReadError) {
      logPick8DatabaseError(
        "created draft reload",
        { matchdayId, userId: user.id },
        createdEntryReadError,
      );
      return failure("Your draft was created but could not be reloaded. Please refresh and try again.");
    }
    entryId = data.id;
  }

  const submittedByFixture = new Map(
    parsed.selections.map((selection) => [selection.fixtureId, selection]),
  );
  const selectionIdsToDelete = (existingSelections ?? [])
    .filter(() => !existingEntry?.submitted_at)
    .filter((existing) => editableFixtureIdSet.has(existing.fixture_id))
    .filter((existing) => {
      const submitted = submittedByFixture.get(existing.fixture_id);
      return (
        !submitted ||
        submitted.category !== existing.category ||
        submitted.selectedTeamSide !== existing.selected_team_side
      );
    })
    .map((selection) => selection.id);

  if (selectionIdsToDelete.length) {
    const { error } = await supabase
      .from("entry_selections")
      .delete()
      .eq("entry_id", entryId)
      .in("id", selectionIdsToDelete);
    if (error) {
      logPick8DatabaseError(
        "draft selection removal",
        { matchdayId, userId: user.id, entryId },
        error,
      );
      return failure("Cleared selections could not be removed.");
    }
  }

  if (parsed.selections.length) {
    const selectionRows = parsed.selections.map((selection) => ({
      entry_id: entryId,
      category: selection.category,
      fixture_id: selection.fixtureId,
      selected_team_side: selection.selectedTeamSide,
      updated_at: nowIso,
    }));
    const changedDraftRows = selectionRows.filter((selection) => {
      const existing = (existingSelections ?? []).find(
        (saved) => saved.fixture_id === selection.fixture_id,
      );
      return !existing ||
        existing.category !== selection.category ||
        existing.selected_team_side !== selection.selected_team_side;
    });
    // Drafts are keyed by fixture and may temporarily contain duplicate
    // categories while a player rearranges picks. Submitted edits use one
    // transactional database update so fixture swaps remain constraint-safe.
    const { error } = existingEntry?.submitted_at
      ? await supabase.rpc("replace_submitted_pick8_selections", {
          check_entry_id: entryId,
          check_selections: selectionRows.map((selection) => ({
            category: selection.category,
            fixture_id: selection.fixture_id,
            selected_team_side: selection.selected_team_side,
          })),
        })
      : changedDraftRows.length
        ? await supabase.from("entry_selections").insert(changedDraftRows)
        : { error: null };
    if (error) {
      logPick8DatabaseError(
        "fixture selection save",
        { matchdayId, userId: user.id, entryId, intent },
        error,
      );
      return failure("Your fixture selections could not be saved. They are still shown in this form; please try again.");
    }
  }

  // Mark submission only after every selection write succeeds, so a partial
  // persistence failure cannot leave an incomplete entry marked submitted.
  const submittedAt = intent === "submit"
    ? nowIso
    : intent === "save_changes"
      ? existingEntry?.submitted_at ?? nowIso
      : null;
  const { error: entryUpdateError } = await supabase
    .from("entries")
    .update({
      total_goals_prediction: totalGoals,
      submitted_at: submittedAt,
      updated_at: nowIso,
    })
    .eq("id", entryId)
    .eq("user_id", user.id);
  if (entryUpdateError) {
    logPick8DatabaseError(
      "entry update",
      { matchdayId, userId: user.id, entryId, intent },
      entryUpdateError,
    );
    if (entryUpdateError.message.includes("Entry must have all seven fixture selections and Total Goals before submission")) {
      return failure(
        "This entry is incomplete and could not be submitted. Complete all seven fixture picks and Total Goals, then try again.",
      );
    }
    return failure("Your entry could not be saved.");
  }

  revalidatePath("/my-picks");

  return {
    ok: true,
    intent,
    submittedAt,
    message: intent === "submit"
      ? "Picks submitted."
      : intent === "save_changes"
        ? "Submitted picks updated."
        : "Draft saved — not submitted.",
  };
}
