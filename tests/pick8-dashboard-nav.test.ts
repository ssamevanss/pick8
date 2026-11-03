import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { ComponentType } from "react";
import type { LatestMatchdayWinners } from "../utils/pick8-latest-winners.ts";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const nativeRequire = createRequire(import.meta.url);

// Transpiles a client component in memory so its server-rendered markup can be asserted.
function loadComponent<P>(path: string, stubs: Record<string, unknown>): ComponentType<P> {
  const file = join(root, path);
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded: { exports: { default?: ComponentType<P> } } = { exports: {} };
  const requireFn = (id: string): unknown => {
    if (id in stubs) return stubs[id];
    if (id.startsWith(".")) return nativeRequire(resolve(dirname(file), id));
    return nativeRequire(id);
  };
  runInNewContext(source, { exports: loaded.exports, module: loaded, require: requireFn, console }, { filename: file });
  assert.ok(loaded.exports.default);
  return loaded.exports.default;
}

const data: LatestMatchdayWinners = {
  matchdayNumber: 8,
  actualGoals: 24,
  hiddenTied: 2,
  winners: [1, 1, 3].map((rank, index) => ({
    playerId: `p${index}`, rank, name: `Player ${index}`, points: 60 - index, totalGoalsPrediction: 20, totalGoalsPoints: 10,
    picks: [], expectedPickCount: 8, complete: true,
  })),
};

function render() {
  const { renderToStaticMarkup } = nativeRequire("react-dom/server") as typeof import("react-dom/server");
  const { createElement } = nativeRequire("react") as typeof import("react");
  const stub = { default: ({ href, children, pendingLabel, className }: { href: string; children: unknown; pendingLabel: string; className: string }) =>
    createElement("a", { href, className, "data-pending-label": pendingLabel }, children as never) };
  const Card = loadComponent<{ data: LatestMatchdayWinners; currentUserId: string }>("components/dashboard/MatchdayWinners.tsx", {
    "@/components/navigation/PendingLink": stub,
  });
  return renderToStaticMarkup(createElement(Card, { data, currentUserId: "p0" }));
}

test("the latest-results card is headed 'Top Players', never 'winners'", () => {
  const html = render();
  assert.match(html, /Matchday 8 Top Players|Matchday <!-- -->8<!-- --> Top Players/);
  assert.doesNotMatch(html, /winner/i);
  assert.match(html, /aria-labelledby="top-players-heading"/);
  assert.match(html, /id="top-players-heading"/);
  assert.match(html, /\+2 more players tied in the top three\./);
});

test("ranks, tie display and the expandable rows are unchanged by the rename", () => {
  const html = render();
  assert.deepEqual([...html.matchAll(/>#(\d)</g)].map((match) => match[1]), ["1", "1", "3"]);
  assert.equal(html.match(/aria-expanded="false"/g)?.length, 3);
  assert.match(html, /min-h-14/);
});

test("the breakdown link announces that it is opening", () => {
  const html = render();
  assert.match(html, /href="\/tables\?view=matchday&(amp;)?matchday=8"/);
  assert.match(html, /data-pending-label="Opening breakdown…"/);
  assert.match(html, /Full matchday breakdown/);
});

test("the dashboard placeholder no longer calls anyone a winner", () => {
  const page = read("app/(app)/dashboard/page.tsx");
  assert.match(page, /Top Players<\/h2>/);
  assert.doesNotMatch(page, /Matchday winners/);
});

test("PendingLink uses next/link status, blocks repeat clicks and has no timer or full-page <a>", () => {
  const source = read("components/navigation/PendingLink.tsx");
  assert.match(source, /import Link, \{ useLinkStatus \} from "next\/link"/);
  assert.match(source, /if \(pendingRef\.current\) event\.preventDefault\(\)/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /animate-spin/);
  assert.match(source, /data-pending="" aria-hidden="true"/, "the visible label is hidden from assistive tech so the live region is the only announcement");
  assert.doesNotMatch(source, /setTimeout|setInterval/, "pending state must be reset by Next, not by a timer that can stick or lie");
  assert.doesNotMatch(source, /<a\b/, "a plain anchor would force a full page load and lose client navigation");
  assert.doesNotMatch(source, /router\.(push|replace)/, "keep native link semantics (new tab, history)");
});

test("/tables has a route-level loading fallback that is marked busy", () => {
  const path = "app/(app)/tables/loading.tsx";
  assert.ok(existsSync(join(root, path)));
  const source = read(path);
  assert.match(source, /aria-busy="true"/);
  assert.match(source, /animate-pulse/);
  assert.doesNotMatch(source, /await |fetch\(|supabase/i, "a fallback must not do its own data loading");
});
