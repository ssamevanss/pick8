import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

test("the inherited /test-supabase debug page stays removed", () => {
  assert.equal(existsSync(join(root, "app/test-supabase")), false);
});
