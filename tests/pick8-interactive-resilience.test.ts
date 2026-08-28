import test from "node:test";
import assert from "node:assert/strict";
import {
  createSupabaseServerFetch,
  Pick8ServiceUnavailableError,
  requireSuccessfulDatabaseOperation,
  SERVER_DATABASE_TIMEOUT_CODE,
  SERVER_DATABASE_UNAVAILABLE_CODE,
} from "../utils/supabase/resilience.ts";
import {
  persistedEntryMatchesIntent,
  resolvePick8Mutation,
  type IntendedPick8Entry,
} from "../utils/pick8-entry-reconciliation.ts";
import { runPick8EntryWriteWhileOpen } from "../utils/pick8-entry-lock.ts";

function hangingFetch(): typeof fetch {
  return async (_input, init) =>
    await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason),
        { once: true },
      );
    });
}

for (const page of ["dashboard", "my-picks", "tables"] as const) {
  test(`${page} query hangs become a bounded retryable page error`, async () => {
    const timeoutMs = 20;
    const dependencyFetch = createSupabaseServerFetch({
      fetchImpl: hangingFetch(),
      databaseReadTimeoutMs: timeoutMs,
      context: { page, operation: `load-${page}` },
    });
    const startedAt = performance.now();
    const response = await dependencyFetch.fetch(
      "https://example.test/rest/v1/matchdays",
    );
    const error = await response.json() as { code: string };

    assert.equal(error.code, SERVER_DATABASE_TIMEOUT_CODE);
    assert.throws(
      () => requireSuccessfulDatabaseOperation(error),
      Pick8ServiceUnavailableError,
    );
    assert.ok(performance.now() - startedAt < 250);
  });
}

test("one hung query in a parallel page group cannot outlive the page budget", async () => {
  const pageSignal = AbortSignal.timeout(25);
  const dependencyFetch = createSupabaseServerFetch({
    fetchImpl: async (input, init) => {
      if (String(input).includes("profiles")) {
        return await hangingFetch()(input, init);
      }
      return Response.json([]);
    },
    databaseReadTimeoutMs: 200,
    overallSignal: pageSignal,
    context: { page: "dashboard", operation: "parallel-page-load" },
  });
  const startedAt = performance.now();

  const responses = await Promise.all([
    dependencyFetch.fetch("https://example.test/rest/v1/profiles"),
    dependencyFetch.fetch("https://example.test/rest/v1/matchdays"),
    dependencyFetch.fetch("https://example.test/rest/v1/competitions"),
  ]);
  const hungError = await responses[0].json() as { code: string };

  assert.equal(hungError.code, SERVER_DATABASE_TIMEOUT_CODE);
  assert.ok(performance.now() - startedAt < 250);
});

test("transient database 5xx is an error rather than misleading empty data", async () => {
  const dependencyFetch = createSupabaseServerFetch({
    fetchImpl: async () => Response.json([], { status: 503 }),
    context: { page: "tables", operation: "load-standings" },
  });
  const response = await dependencyFetch.fetch(
    "https://example.test/rest/v1/entries",
  );
  const error = await response.json() as { code: string };

  assert.equal(response.status, 503);
  assert.equal(error.code, SERVER_DATABASE_UNAVAILABLE_CODE);
  assert.throws(
    () => requireSuccessfulDatabaseOperation(error),
    Pick8ServiceUnavailableError,
  );
});

const intendedEntry: IntendedPick8Entry = {
  intent: "submit",
  totalGoals: 25,
  selections: Array.from({ length: 7 }, (_, index) => ({
    category: `category-${index}`,
    fixtureId: `fixture-${index}`,
    selectedTeamSide: index % 2 ? "away" : "home",
  })),
};

test("entry submission succeeds normally without reconciliation", async () => {
  let reconciliations = 0;
  const result = await resolvePick8Mutation({
    mutate: async () => ({
      data: { submitted_at: "2026-08-28T00:00:00Z" },
      error: null,
    }),
    isUncertainError: () => false,
    reconcile: async () => {
      reconciliations += 1;
      return null;
    },
  });

  assert.equal(result.kind, "success");
  assert.equal(result.kind === "success" && result.reconciled, false);
  assert.equal(reconciliations, 0);
});

test("a definite entry failure before or during mutation is not reconciled or retried", async () => {
  let mutationCalls = 0;
  let reconciliations = 0;
  const definiteError = { code: "23514", message: "invalid selection" };
  const result = await resolvePick8Mutation({
    mutate: async () => {
      mutationCalls += 1;
      return { data: null, error: definiteError };
    },
    isUncertainError: () => false,
    reconcile: async () => {
      reconciliations += 1;
      return null;
    },
  });

  assert.deepEqual(result, { kind: "failure", error: definiteError });
  assert.equal(mutationCalls, 1);
  assert.equal(reconciliations, 0);
});

test("an entry RPC hang before commit has an unknown outcome and is never retried", async () => {
  let mutationCalls = 0;
  const dependencyFetch = createSupabaseServerFetch({
    fetchImpl: hangingFetch(),
    databaseMutationTimeoutMs: 20,
    context: { action: "my-picks.save-entry", operation: "save_pick8_entry" },
  });
  const result = await resolvePick8Mutation({
    mutate: async () => {
      mutationCalls += 1;
      const response = await dependencyFetch.fetch(
        "https://example.test/rest/v1/rpc/save_pick8_entry",
        { method: "POST", body: "{}" },
      );
      return {
        data: null,
        error: await response.json() as { code: string; message: string },
      };
    },
    isUncertainError: (error) => error.code === SERVER_DATABASE_TIMEOUT_CODE,
    reconcile: async () => null,
  });

  assert.equal(result.kind, "unknown");
  assert.equal(mutationCalls, 1);
});

test("a committed entry with a lost response is detected by reconciliation", async () => {
  let mutationCalls = 0;
  let persisted: Parameters<typeof persistedEntryMatchesIntent>[1] | null = null;
  const result = await resolvePick8Mutation({
    mutate: async () => {
      mutationCalls += 1;
      persisted = {
        submittedAt: "2026-08-28T00:00:00Z",
        totalGoals: intendedEntry.totalGoals,
        selections: intendedEntry.selections,
      };
      return {
        data: null,
        error: {
          code: SERVER_DATABASE_TIMEOUT_CODE,
          message: "response lost",
        },
      };
    },
    isUncertainError: (error) => error.code === SERVER_DATABASE_TIMEOUT_CODE,
    reconcile: async () =>
      persisted && persistedEntryMatchesIntent(intendedEntry, persisted)
        ? { submitted_at: persisted.submittedAt }
        : null,
  });

  assert.equal(result.kind, "success");
  assert.equal(result.kind === "success" && result.reconciled, true);
  assert.equal(mutationCalls, 1, "the mutation must not be retried");
  assert.equal(persisted?.selections.length, 7);
});

test("entry reconciliation compares exact rows without creating duplicates", () => {
  const persisted = {
    submittedAt: "2026-08-28T00:00:00Z",
    totalGoals: 25,
    selections: [...intendedEntry.selections].reverse(),
  };

  assert.equal(persistedEntryMatchesIntent(intendedEntry, persisted), true);
  assert.equal(persisted.selections.length, 7);
});

test("entry timeout handling leaves kickoff locking unchanged", async () => {
  let writes = 0;
  const result = await runPick8EntryWriteWhileOpen({
    matchdayStatus: "scheduled",
    firstKickoff: "2026-08-28T12:00:00Z",
    now: Date.parse("2026-08-28T12:00:00Z"),
    write: async () => {
      writes += 1;
      return true;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(writes, 0);
});
