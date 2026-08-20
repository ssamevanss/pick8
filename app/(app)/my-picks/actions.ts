"use server";

import { revalidatePath } from "next/cache";
import { getRequestAuthContext } from "@/utils/app-context";
import { earliestFixtureKickoff } from "@/utils/pick8-fixture-state";
import {
  PICK8_MATCHDAY_LOCKED_MESSAGE,
  runPick8EntryWriteWhileOpen,
} from "@/utils/pick8-entry-lock";
import {
  getDuplicatePick8Categories,
  getMissingPick8Categories,
  parsePick8DraftSelections,
  PICK8_CATEGORIES,
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
  if (!profile.pick8_participation_active) {
    return failure("Your Pick8 participation is paused. You can still view previous entries and results.");
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

  const { data: eligibleFixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("id, kickoff_at, status")
    .eq("matchday_id", matchdayId);
  if (fixturesError) return failure("Fixtures could not be verified.");
  const effectiveLocksAt = earliestFixtureKickoff(eligibleFixtures ?? []) ?? matchday.locks_at;
  const fixtureIds = (eligibleFixtures ?? []).map((fixture) => fixture.id);
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
  if (intent === "submit" && existingEntry?.submitted_at) {
    return failure("This entry is already submitted. Enter edit mode to change it before the first kickoff.");
  }

  const parsed = parsePick8DraftSelections(formData, fixtureIds);
  if ("error" in parsed) {
    return failure(parsed.error ?? "One or more selections are malformed.");
  }
  if (intent !== "draft" && getDuplicatePick8Categories(parsed.selections).length) {
    return failure("Each prediction category can only be used once.");
  }

  const totalGoalsRaw = String(formData.get("total_goals") ?? "").trim();
  const totalGoals = totalGoalsRaw === "" ? null : Number(totalGoalsRaw);
  if (totalGoals !== null && (!Number.isInteger(totalGoals) || totalGoals < 0 || totalGoals > 100)) {
    return failure("Total Goals must be a whole number between 0 and 100.");
  }
  if (intent === "submit" || intent === "save_changes") {
    const missingCategories = getMissingPick8Categories(parsed.selections);
    if (totalGoals === null || parsed.selections.length !== REQUIRED_CATEGORIES.length || missingCategories.length) {
      const missing = [
        ...missingCategories.map((category) => category.replaceAll("_", " ")),
        ...(totalGoals === null ? ["total goals"] : []),
      ];
      return failure(`Incomplete entry. Missing: ${missing.join(", ")}.`);
    }
  }

  const guardedWrite = await runPick8EntryWriteWhileOpen({
    matchdayStatus: matchday.status,
    firstKickoff: effectiveLocksAt,
    // This second wall-clock read is deliberately adjacent to the database
    // request. The database function checks its own clock again while holding
    // the Matchday row lock and commits all entry changes atomically.
    now: Date.now(),
    write: async () => supabase.rpc("save_pick8_entry", {
      check_matchday_id: matchdayId,
      check_intent: intent,
      check_total_goals: totalGoals,
      check_selections: parsed.selections.map((selection) => ({
        category: selection.category,
        fixture_id: selection.fixtureId,
        selected_team_side: selection.selectedTeamSide,
      })),
    }),
  });
  if (!guardedWrite.ok) return failure(guardedWrite.message);

  const { data: savedEntry, error: entryUpdateError } = guardedWrite.value;
  if (entryUpdateError) {
    logPick8DatabaseError(
      "atomic entry save",
      { matchdayId, userId: user.id, entryId: existingEntry?.id, intent },
      entryUpdateError,
    );
    if (entryUpdateError.message.includes("Matchday has locked")) {
      return failure(PICK8_MATCHDAY_LOCKED_MESSAGE);
    }
    if (entryUpdateError.message.includes("Entry must have all seven fixture selections and Total Goals before submission")) {
      return failure(
        "This entry is incomplete and could not be submitted. Complete all seven fixture picks and Total Goals, then try again.",
      );
    }
    return failure("Your entry could not be saved.");
  }

  const savedEntryResult = savedEntry as { submitted_at?: string | null } | null;
  const submittedAt = savedEntryResult?.submitted_at ?? null;

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
