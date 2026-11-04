import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// `fetchAllRows` is server-only; neutralize that import so this file can load
// it directly, the same pattern Who You Got's tests use for server-only utils.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") {
      return { url: "pagination-test:server-only", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return next(new URL("../" + specifier.slice(2) + ".ts", import.meta.url).href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "pagination-test:server-only") {
      return { format: "module", shortCircuit: true, source: "" };
    }
    return next(url, context);
  },
});

const { fetchAllRows } = await import("../utils/paginated-read.ts");

function page(rows, count) {
  return { data: rows, error: null, count };
}

test("concatenates every page once the running total reaches the exact count", async () => {
  const pages = [page([{ id: 1 }, { id: 2 }], 5), page([{ id: 3 }, { id: 4 }], 5), page([{ id: 5 }], 5)];
  const ranges = [];
  const rows = await fetchAllRows(
    ({ from, to }) => {
      ranges.push([from, to]);
      return pages.shift();
    },
    { pageSize: 2 },
  );

  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(ranges, [
    [0, 1],
    [2, 3],
    [4, 5],
  ]);
});

test("returns an empty array without issuing a page when the count is zero", async () => {
  let calls = 0;
  const rows = await fetchAllRows(() => {
    calls += 1;
    return page([], 0);
  });

  assert.deepEqual(rows, []);
  assert.equal(calls, 1);
});

test("a single page under the page size resolves without a second request", async () => {
  let calls = 0;
  const rows = await fetchAllRows(() => {
    calls += 1;
    return page([{ id: "a" }, { id: "b" }], 2);
  });

  assert.deepEqual(rows, [{ id: "a" }, { id: "b" }]);
  assert.equal(calls, 1);
});

test("fails closed on a query error instead of returning a partial result", async () => {
  await assert.rejects(
    () => fetchAllRows(() => ({ data: null, error: { message: "db down" }, count: null })),
    /temporarily unavailable/,
  );
});

for (const [name, badCount] of [
  ["a missing count", null],
  ["a non-integer count", 1.5],
  ["a negative count", -1],
]) {
  test(`fails closed on ${name}`, async () => {
    await assert.rejects(() => fetchAllRows(() => page([{ id: 1 }], badCount)));
  });
}

test("fails closed when the count changes between pages (concurrent writes mid-read)", async () => {
  const pages = [page([{ id: 1 }], 3), page([{ id: 2 }], 4)];
  await assert.rejects(() => fetchAllRows(() => pages.shift(), { pageSize: 1 }));
});

test("fails closed on a premature empty page instead of silently truncating", async () => {
  const pages = [page([{ id: 1 }], 3), page([], 3)];
  await assert.rejects(() => fetchAllRows(() => pages.shift(), { pageSize: 1 }));
});

test("fails closed if more rows come back than the reported count", async () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({ id: i }));
  await assert.rejects(() => fetchAllRows(() => page(rows, 2)));
});

test("pages past 1,000 rows without truncating - the scenario a full season of entries creates", async () => {
  const total = 1_900; // e.g. 38 matchdays x 50 players
  const allRows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const pageSize = 500;
  const rows = await fetchAllRows(
    ({ from, to }) => page(allRows.slice(from, to + 1), total),
    { pageSize },
  );

  assert.equal(rows.length, total);
  assert.deepEqual(rows.map((row) => row.id), allRows.map((row) => row.id));
});
