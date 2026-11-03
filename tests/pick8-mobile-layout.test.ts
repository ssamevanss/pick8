import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

// Source-level guards for the two causes of horizontal overflow on narrow phones (320-430px). The visual
// behaviour itself is verified in a browser; these stop the known patterns coming back.

test("standings tables compact to the viewport instead of forcing a minimum width and scrolling", () => {
  const source = read("app/(app)/tables/page.tsx");
  const table = source.slice(source.indexOf("function StandingsTable"), source.indexOf("export default async function TablesPage"));
  assert.doesNotMatch(table, /min-w-\[/, "a fixed table minimum width clips columns on phones");
  assert.doesNotMatch(table, /overflow-x-(auto|scroll)/, "columns must fit rather than scroll sideways");
  assert.match(table, /\[overflow-wrap:anywhere\]/, "long player names must be able to wrap");
  for (const label of ["Points", "Played", "Average"]) {
    assert.match(table, new RegExp(`sr-only sm:not-sr-only">${label}<`), `${label} keeps its full accessible/desktop label`);
  }
});

test("responsive grids on live pages declare a single-column base track so long names cannot widen the page", () => {
  const files = [
    "app/(app)/dashboard/page.tsx",
    "app/(app)/tables/page.tsx",
    "app/(app)/my-picks/page.tsx",
    "components/picks/SubmittedPick8Summary.tsx",
    "components/picks/ReadOnlyMatchdayPicks.tsx",
  ];
  for (const file of files) {
    // `grid gap-N sm:grid-cols-…` (no base grid-cols) sizes its implicit column to min-content.
    const offenders = read(file).match(/\bgrid gap-[\d.]+ (?:sm|md|lg):grid-cols-[^\s"`]+/g) ?? [];
    assert.deepEqual(offenders, [], `${file} has a responsive grid without grid-cols-1`);
  }
});
