import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RETIRED_CRON_ROUTES, retiredCronRouteResponse } from "../utils/pick8-retired-routes.ts";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const PICK8_CRON_ROUTES = ["reconcile-results", "sync-fixtures", "sync-results"];

test("the public debug page is gone", () => {
  assert.equal(existsSync(join(root, "app/test-supabase")), false);
});

test("the only concrete cron routes are the Pick8 ones, each behind the Bearer-only guard", () => {
  const routeDirs = readdirSync(join(root, "app/api/cron")).filter((name) => !name.startsWith("["));
  assert.deepEqual(routeDirs.sort(), PICK8_CRON_ROUTES);
  for (const name of routeDirs) {
    const source = read(`app/api/cron/${name}/route.ts`);
    assert.match(source, /authorizePick8Cron\(request\)/, `${name} must authorize with the shared guard`);
    assert.doesNotMatch(source, /searchParams\.get\(["']token["']\)/, `${name} must not accept a query-string secret`);
  }
});

test("vercel.json schedules only routes that exist and are not retired", () => {
  const { crons } = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
  for (const { path } of crons) {
    const name = path.replace("/api/cron/", "");
    assert.ok(PICK8_CRON_ROUTES.includes(name), `${path} must be a Pick8 cron route`);
    assert.equal(RETIRED_CRON_ROUTES.has(name), false);
  }
});

test("no retired route name collides with a live Pick8 route", () => {
  for (const name of PICK8_CRON_ROUTES) assert.equal(RETIRED_CRON_ROUTES.has(name), false);
});

test("the WYG admin API routes are gone and no cron route uses the WYG-schema clients", () => {
  assert.equal(existsSync(join(root, "app/api/admin")), false);
  const offenders = walk("app/api/cron").filter((file) => /legacy-(admin|server)|route-auth/.test(read(file)));
  assert.deepEqual(offenders, []);
});

test("the WYG admin server actions (profiles.role/status model) are no longer in the build graph", () => {
  assert.equal(existsSync(join(root, "app/(app)/admin/actions.ts")), false);
  const importers = [...walk("app"), ...walk("components"), ...walk("utils")]
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => /admin\/actions["']/.test(read(file)));
  assert.deepEqual(importers, []);
});

test("retired cron routes answer 410 without running anything", async () => {
  const warn = console.warn;
  const logged: string[] = [];
  console.warn = (line: unknown) => { logged.push(String(line)); };
  try {
    for (const name of RETIRED_CRON_ROUTES) {
      const response = retiredCronRouteResponse(name, "GET");
      assert.equal(response.status, 410);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { ok: false, error: "This endpoint has been retired." });
    }
  } finally {
    console.warn = warn;
  }
  assert.equal(logged.length, RETIRED_CRON_ROUTES.size);
  const entry = JSON.parse(logged[0]);
  assert.deepEqual(Object.keys(entry).sort(), ["method", "route", "service"]);
  assert.equal(entry.service, "pick8-retired-route");
});

test("unknown cron names are 404 and are not logged as retired hits", () => {
  const warn = console.warn;
  let calls = 0;
  console.warn = () => { calls += 1; };
  try {
    assert.equal(retiredCronRouteResponse("does-not-exist", "GET").status, 404);
    assert.equal(retiredCronRouteResponse("sync-results", "GET").status, 404);
  } finally {
    console.warn = warn;
  }
  assert.equal(calls, 0);
});
