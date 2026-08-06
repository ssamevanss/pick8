"use server";

import { getRequestAuthContext } from "@/utils/app-context";

const CATEGORY_RULES = {
  home_win: ["home"],
  away_win: ["away"],
  draw: [null],
  team_win: ["home", "away"],
  team_lose: ["home", "away"],
  team_score: ["home", "away"],
  clean_sheet: ["home", "away"],
} as const;

type Category = keyof typeof CATEGORY_RULES;
type TeamSide = "home" | "away" | null;

export type PickEntryActionState = {
  ok: boolean;
  message: string;
  intent?: "draft" | "submit" | "save_changes";
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

function getDuplicateCategories(selections: SubmittedSelection[]) {
  const counts = new Map<Category, number>();
  for (const selection of selections) {
    counts.set(selection.category, (counts.get(selection.category) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1);
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

  const editable = matchday.status === "open" || matchday.status === "upcoming";
  const lockTime = matchday.locks_at
    ? new Date(matchday.locks_at).getTime()
    : Number.NaN;
  if (!editable || !Number.isFinite(lockTime) || Date.now() >= lockTime) {
    return failure("This matchday is locked and can no longer be edited.");
  }

  const { data: eligibleFixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("id")
    .eq("matchday_id", matchdayId)
    .not("status", "in", "(cancelled,postponed)");
  if (fixturesError) return failure("Fixtures could not be verified.");
  const eligibleFixtureIds = (eligibleFixtures ?? []).map((fixture) => fixture.id);
  const parsed = parseSelections(formData, eligibleFixtureIds);
  if ("error" in parsed) {
    return failure(parsed.error ?? "One or more selections are malformed.");
  }
  if (getDuplicateCategories(parsed.selections).length) {
    return failure(
      intent === "draft"
        ? "Duplicate categories can remain while editing, but cannot be saved because the current Pick8 schema stores one fixture per category. Resolve the highlighted duplicates first."
        : "Each prediction category can only be used once.",
    );
  }

  const totalGoalsRaw = String(formData.get("total_goals") ?? "").trim();
  const totalGoals = totalGoalsRaw === "" ? null : Number(totalGoalsRaw);
  if (
    totalGoals !== null &&
    (!Number.isInteger(totalGoals) || totalGoals < 0 || totalGoals > 100)
  ) {
    return failure("Total Goals must be a whole number between 0 and 100.");
  }

  const requiredSelections = Math.min(7, eligibleFixtureIds.length);
  if (intent === "submit" || intent === "save_changes") {
    if (totalGoals === null || parsed.selections.length !== requiredSelections) {
      return failure(
        `Incomplete entry: choose ${requiredSelections} fixture categor${requiredSelections === 1 ? "y" : "ies"} and enter Total Goals.`,
      );
    }
  }

  const nowIso = new Date().toISOString();
  const { data: existingEntry, error: entryReadError } = await supabase
    .from("entries")
    .select("id, submitted_at")
    .eq("user_id", user.id)
    .eq("matchday_id", matchdayId)
    .maybeSingle();
  if (entryReadError) return failure("Your entry could not be loaded.");
  if (intent === "save_changes" && !existingEntry?.submitted_at) {
    return failure("There is no submitted entry to update.");
  }
  if (intent === "draft" && existingEntry?.submitted_at) {
    return failure(
      "This entry is already submitted. Use Save Changes to keep it submitted.",
    );
  }

  let entryId = existingEntry?.id;
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

  const { data: existingSelections, error: selectionsReadError } = await supabase
    .from("entry_selections")
    .select("id, category, fixture_id, selected_team_side")
    .eq("entry_id", entryId);
  if (selectionsReadError) return failure("Your saved selections could not be loaded.");

  const submittedByCategory = new Map(
    parsed.selections.map((selection) => [selection.category, selection]),
  );
  const selectionIdsToDelete = (existingSelections ?? [])
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
  if (entryUpdateError) return failure("Your entry could not be saved.");

  return {
    ok: true,
    intent,
    message: intent === "submit"
      ? "Picks submitted."
      : intent === "save_changes"
        ? "Submitted picks updated."
        : "Draft saved.",
  };
}
