"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/utils/supabase/server";
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
import {
  persistedEntryMatchesIntent,
  resolvePick8Mutation,
  type IntendedPick8Entry,
  type Pick8EntryIntent,
} from "@/utils/pick8-entry-reconciliation";
import {
  classifyServerAuth,
  isDatabaseTimeoutError,
  isTransientDatabaseError,
} from "@/utils/supabase/resilience";

const REQUIRED_CATEGORIES = PICK8_CATEGORIES;
const ENTRY_PRIMARY_ACTION_TIMEOUT_MS = 20_000;
const ENTRY_TOTAL_ACTION_TIMEOUT_MS = 30_000;
const ENTRY_RPC_TIMEOUT_MS = 17_000;
const ENTRY_RECONCILIATION_TIMEOUT_MS = 10_000;

export type PickEntryActionState = {
  ok: boolean;
  message: string;
  intent?: "draft" | "submit" | "save_changes";
  submittedAt?: string | null;
  outcome?: "failure" | "success" | "unknown";
};

function failure(message: string): PickEntryActionState {
  return { ok: false, message, outcome: "failure" };
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

function logEntryResilience(
  classification: "timeout" | "unavailable" | "reconciled" | "unknown",
  fields: Record<string, unknown>,
) {
  console.info(JSON.stringify({
    service: "pick8-entry-save",
    dependency: "database",
    operation: "save_pick8_entry",
    action: "my-picks.save-entry",
    classification,
    region: process.env.VERCEL_REGION ?? null,
    ...fields,
  }));
}

function waitForReconciliation(signal: AbortSignal, delayMs: number) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve(true);
    }, delayMs);
    function handleAbort() {
      clearTimeout(timer);
      resolve(false);
    }
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

async function reconcileEntrySave({
  userId,
  matchdayId,
  intended,
  requestId,
  timeoutMs,
}: {
  userId: string;
  matchdayId: string;
  intended: IntendedPick8Entry;
  requestId: string | null;
  timeoutMs: number;
}) {
  const reconciliationSignal = AbortSignal.timeout(timeoutMs);
  const supabase = await createClient({
    overallSignal: reconciliationSignal,
    context: {
      action: "my-picks.save-entry",
      operation: "reconcile-entry-save",
      requestId,
    },
    databaseReadTimeoutMs: timeoutMs,
  });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { data: entry, error: entryError } = await supabase
      .from("entries")
      .select("id, total_goals_prediction, submitted_at")
      .eq("user_id", userId)
      .eq("matchday_id", matchdayId)
      .maybeSingle();
    if (!entryError && entry) {
      const { data: selections, error: selectionsError } = await supabase
        .from("entry_selections")
        .select("category, fixture_id, selected_team_side")
        .eq("entry_id", entry.id);
      if (!selectionsError && persistedEntryMatchesIntent(intended, {
        submittedAt: entry.submitted_at,
        totalGoals: entry.total_goals_prediction,
        selections: (selections ?? []).map((selection) => ({
          category: selection.category,
          fixtureId: selection.fixture_id,
          selectedTeamSide: selection.selected_team_side,
        })),
      })) {
        return { submitted_at: entry.submitted_at };
      }
    }

    if (attempt < 3) {
      const shouldContinue = await waitForReconciliation(
        reconciliationSignal,
        attempt * 400,
      );
      if (!shouldContinue) return null;
    }
  }
  return null;
}

export async function savePickEntry(
  _previousState: PickEntryActionState,
  formData: FormData,
): Promise<PickEntryActionState> {
  const startedAt = performance.now();
  const totalDeadlineAt = startedAt + ENTRY_TOTAL_ACTION_TIMEOUT_MS;
  const requestHeaders = await headers();
  const requestId = requestHeaders.get("x-vercel-id") ??
    requestHeaders.get("x-request-id");
  const actionSignal = AbortSignal.timeout(ENTRY_PRIMARY_ACTION_TIMEOUT_MS);
  const supabase = await createClient({
    overallSignal: actionSignal,
    context: {
      action: "my-picks.save-entry",
      operation: "entry-save",
      requestId,
    },
    databaseMutationTimeoutMs: ENTRY_RPC_TIMEOUT_MS,
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const authState = classifyServerAuth({ user: authData.user, error: authError });
  if (authState.kind === "unavailable") {
    return failure("Pick8 could not verify your session just now. Your picks are still on this screen; please try again.");
  }
  const user = authState.kind === "authenticated" ? authData.user : null;
  if (!user) return failure("An active Pick8 account is required.");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_active, pick8_participation_active")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    return failure("Pick8 could not verify your account just now. Your picks are still on this screen; please try again.");
  }
  if (!user || !profile?.is_active) {
    return failure("An active Pick8 account is required.");
  }
  if (!profile.pick8_participation_active) {
    return failure("Your Pick8 participation is paused. You can still view previous entries and results.");
  }

  const rawIntent = String(formData.get("intent") ?? "draft");
  const intent: Pick8EntryIntent = rawIntent === "submit"
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
  if (matchdayError) return failure(
    isTransientDatabaseError(matchdayError)
      ? "The matchday service is temporarily unavailable. Your picks are still on this screen; please try again."
      : "The matchday could not be verified.",
  );
  if (!matchday) return failure("This matchday is not in the active season.");

  const { data: eligibleFixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("id, kickoff_at, status")
    .eq("matchday_id", matchdayId);
  if (fixturesError) return failure(
    isTransientDatabaseError(fixturesError)
      ? "Fixtures are temporarily unavailable. Your picks are still on this screen; please try again."
      : "Fixtures could not be verified.",
  );
  const effectiveLocksAt = earliestFixtureKickoff(eligibleFixtures ?? []) ?? matchday.locks_at;
  const fixtureIds = (eligibleFixtures ?? []).map((fixture) => fixture.id);
  const { data: existingEntry, error: entryReadError } = await supabase
    .from("entries")
    .select("id, submitted_at")
    .eq("user_id", user.id)
    .eq("matchday_id", matchdayId)
    .maybeSingle();
  if (entryReadError) return failure(
    isTransientDatabaseError(entryReadError)
      ? "Your saved entry is temporarily unavailable. Your picks are still on this screen; please try again."
      : "Your entry could not be loaded.",
  );
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

  const intended: IntendedPick8Entry = {
    intent,
    totalGoals,
    selections: parsed.selections.map((selection) => ({
      category: selection.category,
      fixtureId: selection.fixtureId,
      selectedTeamSide: selection.selectedTeamSide,
    })),
  };
  const guardedWrite = await runPick8EntryWriteWhileOpen({
    matchdayStatus: matchday.status,
    firstKickoff: effectiveLocksAt,
    // This second wall-clock read is deliberately adjacent to the database
    // request. The database function checks its own clock again while holding
    // the Matchday row lock and commits all entry changes atomically.
    now: Date.now(),
    write: async () => resolvePick8Mutation({
      mutate: async () => supabase.rpc("save_pick8_entry", {
        check_matchday_id: matchdayId,
        check_intent: intent,
        check_total_goals: totalGoals,
        check_selections: intended.selections.map((selection) => ({
          category: selection.category,
          fixture_id: selection.fixtureId,
          selected_team_side: selection.selectedTeamSide,
        })),
      }),
      isUncertainError: isTransientDatabaseError,
      reconcile: async () => reconcileEntrySave({
        userId: user.id,
        matchdayId,
        intended,
        requestId,
        timeoutMs: Math.max(
          1,
          Math.min(
            ENTRY_RECONCILIATION_TIMEOUT_MS,
            Math.floor(totalDeadlineAt - performance.now()),
          ),
        ),
      }),
    }),
  });
  if (!guardedWrite.ok) return failure(guardedWrite.message);

  const mutation = guardedWrite.value;
  if (mutation.kind === "unknown") {
    logEntryResilience(
      isDatabaseTimeoutError(mutation.error) ? "timeout" : "unavailable",
      {
        requestId,
        elapsedMs: Math.round(performance.now() - startedAt),
      },
    );
    return {
      ok: false,
      outcome: "unknown",
      intent,
      message: `Your ${intent === "draft" ? "draft save" : "submission"} took longer than expected. We checked, but could not yet confirm the final saved state. Reload your saved entry before trying again.`,
    };
  }

  if (mutation.kind === "failure") {
    const entryUpdateError = mutation.error;
    logPick8DatabaseError(
      "atomic entry save",
      { intent },
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

  if (mutation.reconciled) {
    logEntryResilience("reconciled", {
      requestId,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  }
  const savedEntryResult = mutation.value as { submitted_at?: string | null } | null;
  const submittedAt = savedEntryResult?.submitted_at ?? null;

  revalidatePath("/my-picks");

  return {
    ok: true,
    outcome: "success",
    intent,
    submittedAt,
    message: mutation.reconciled
      ? "Your save took longer than expected, but Pick8 checked and confirmed it was saved."
      : intent === "submit"
        ? "Picks submitted."
        : intent === "save_changes"
          ? "Submitted picks updated."
          : "Draft saved — not submitted.",
  };
}
