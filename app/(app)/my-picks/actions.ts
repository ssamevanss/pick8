"use server";

import { revalidatePath } from "next/cache";
import { getRequestAuthContext } from "@/utils/app-context";
import {
  earliestFixtureKickoff,
  isFixtureSelectionEditable,
} from "@/utils/pick8-fixture-state";
import {
  getDuplicatePick8Categories,
  getMissingPick8Categories,
  PICK8_CATEGORIES,
  type Pick8Category,
} from "@/utils/pick8-entry-validation";

const CATEGORY_RULES = {
  home_win: ["home"],
  away_win: ["away"],
  draw: [null],
  team_win: ["home", "away"],
  team_lose: ["home", "away"],
  team_score: ["home", "away"],
  clean_sheet: ["home", "away"],
} as const;

const REQUIRED_CATEGORIES = PICK8_CATEGORIES;

type Category = Pick8Category;
type TeamSide = "home" | "away" | null;

export type PickEntryActionState = {
  ok: boolean;
  message: string;
  intent?: "draft" | "submit" | "save_changes";
  submittedAt?: string | null;
};

type SubmittedSelection = {
  category: Category;
  fixtureId: string;
  selectedTeamSide: TeamSide;
};

function failure(message: string): PickEntryActionState {
  return { ok: false, message };
}

function isCategory(value: string): value is Category {
  return Object.hasOwn(CATEGORY_RULES, value);
}

function parseSelections(formData: FormData, eligibleFixtureIds: string[]) {
  const selections: SubmittedSelection[] = [];

  for (const fixtureId of eligibleFixtureIds) {
    const category = String(
      formData.get(`fixture_category_${fixtureId}`) ?? "",
    ).trim();
    if (!category) continue;
    if (!isCategory(category)) {
      return { error: "One or more fixture categories are invalid." } as const;
    }
    const sideValue = String(
      formData.get(`fixture_side_${fixtureId}`) ?? "",
    ).trim();
    let selectedTeamSide: TeamSide;
    if (category === "home_win") selectedTeamSide = "home";
    else if (category === "away_win") selectedTeamSide = "away";
    else if (category === "draw") selectedTeamSide = null;
    else if (sideValue === "home" || sideValue === "away") {
      selectedTeamSide = sideValue;
    } else {
      return { error: "Choose a team for every team-based category." } as const;
    }
    if (!CATEGORY_RULES[category].includes(selectedTeamSide as never)) {
      return { error: "One or more category/team selections are invalid." } as const;
    }
    selections.push({ category, fixtureId, selectedTeamSide });
  }

  return { selections } as const;
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
  const lockTime = effectiveLocksAt
    ? new Date(effectiveLocksAt).getTime()
    : Number.NaN;
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
  const initialWindowOpen =
    (matchday.status === "open" || matchday.status === "upcoming") &&
    Number.isFinite(lockTime) && requestNow < lockTime;
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

  const parsed = parseSelections(formData, editableFixtureIds);
  if ("error" in parsed) {
    return failure(parsed.error ?? "One or more selections are malformed.");
  }
  const editableFixtureIdSet = new Set(editableFixtureIds);
  const preservedSelections: SubmittedSelection[] = (existingSelections ?? [])
    .filter((selection) => !editableFixtureIdSet.has(selection.fixture_id))
    .filter((selection) => isCategory(selection.category))
    .map((selection) => ({
      category: selection.category as Category,
      fixtureId: selection.fixture_id,
      selectedTeamSide: selection.selected_team_side as TeamSide,
    }));
  const mergedSelections = [...preservedSelections, ...parsed.selections];
  if (getDuplicatePick8Categories(mergedSelections).length) {
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
    const { data, error } = await supabase
      .from("entries")
      .insert({
        user_id: user.id,
        matchday_id: matchdayId,
        total_goals_prediction: totalGoals,
        submitted_at: null,
      })
      .select("id")
      .single();
    if (error) return failure("Your entry could not be created.");
    entryId = data.id;
  }

  const submittedByCategory = new Map(
    parsed.selections.map((selection) => [selection.category, selection]),
  );
  const selectionIdsToDelete = (existingSelections ?? [])
    .filter(() => !existingEntry?.submitted_at)
    .filter((existing) => editableFixtureIdSet.has(existing.fixture_id))
    .filter((existing) => {
      const submitted = isCategory(existing.category)
        ? submittedByCategory.get(existing.category)
        : undefined;
      return (
        !submitted ||
        submitted.fixtureId !== existing.fixture_id ||
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
    if (error) return failure("Cleared selections could not be removed.");
  }

  if (parsed.selections.length) {
    const { error } = await supabase.from("entry_selections").upsert(
      parsed.selections.map((selection) => ({
        entry_id: entryId,
        category: selection.category,
        fixture_id: selection.fixtureId,
        selected_team_side: selection.selectedTeamSide,
        updated_at: nowIso,
      })),
      { onConflict: "entry_id,category" },
    );
    if (error) return failure("Your fixture selections could not be saved.");
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
