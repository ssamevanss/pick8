import "server-only";

import { Pick8ServiceUnavailableError } from "@/utils/supabase/resilience";

type PageResult<T> = {
  data: T[] | null;
  error: unknown;
  count: number | null;
};

/**
 * Reads every row of a query by paging with `.range()`, instead of trusting a
 * single unpaginated `.select()` to return everything. PostgREST's configured
 * max-rows limit is an opaque project setting (not visible from this repo) and
 * a read that exceeds it comes back as a normal 200 with a silently truncated
 * page, not an error. A season-long `entries` read (every matchday's entries,
 * across every player) can cross that cap well within ordinary use, which
 * would quietly corrupt the standings tables and recent-results cards for
 * every player instead of failing loudly.
 *
 * `buildPage` must reissue the full query (filters, a stable `.order()`) for
 * each page and append `.range(from, to)` with `{ count: "exact" }` selected.
 * The exact count is compared across pages, so a result that changes size
 * mid-read (concurrent writes) is rejected rather than silently accepted. A
 * stable order is required: without one, Postgres does not guarantee the
 * same row lands on the same page twice, and `.range()` paging can skip or
 * duplicate rows.
 *
 * Throws `Pick8ServiceUnavailableError("database")` on any query error or on
 * a read that cannot be verified complete, matching
 * `requireSuccessfulDatabaseOperation`'s existing fail-closed convention.
 */
export async function fetchAllRows<T>(
  buildPage: (range: { from: number; to: number }) => PromiseLike<PageResult<T>>,
  { pageSize = 500 }: { pageSize?: number } = {},
): Promise<T[]> {
  const rows: T[] = [];
  let expectedCount: number | null = null;

  while (true) {
    const from = rows.length;
    const { data, error, count } = await buildPage({
      from,
      to: from + pageSize - 1,
    });

    if (error) {
      throw new Pick8ServiceUnavailableError("database");
    }

    if (
      count === null ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      (expectedCount !== null && count !== expectedCount)
    ) {
      throw new Pick8ServiceUnavailableError("database");
    }
    expectedCount = count;

    const page = data ?? [];
    rows.push(...page);

    if (rows.length === expectedCount) {
      return rows;
    }
    if (page.length === 0 || rows.length > expectedCount) {
      throw new Pick8ServiceUnavailableError("database");
    }
  }
}
