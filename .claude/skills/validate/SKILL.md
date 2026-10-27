---
name: validate
description: Run Pick8's validation suite and report results, separating pre-existing failures from new ones. Use before saying work is done, before a commit/PR, or when asked "does it pass?".
---
# Validate

Run from the repo root, in this order, and keep the output compact (`| tail -n 30`):

1. `npm run typecheck` — app code must be clean.
2. `npm run lint`
3. `npm test` — node:test suites in `tests/`.
4. `npm run build` — only for changes touching routes, config, env use or dependencies.
5. DB-level, when the change touches `supabase/migrations`, scoring, or sync state:
   `PICK8_PGLITE_MODULE=<abs path to @electric-sql/pglite/dist/index.js> node --experimental-strip-types --test tests/pick8-sync-migration.mjs`
   (PGlite is not a dependency here; if absent, say the check was skipped).
6. `npm run typecheck:tests` — expected to fail today (40 test-only errors recorded in
   `docs/DEVELOPMENT.md`). Report the count; flag any *increase* as a regression.

Report format: one line per check — pass/fail/skipped, counts, and for failures the first error.
Classify each failure as **pre-existing** (matches `docs/DEVELOPMENT.md`) or **introduced**; verify
by `git stash`-free means (e.g. compare with `git worktree` of the base commit) if unsure.
Never mark done on a failing or skipped required check without saying so. Don't touch the owner's
unrelated uncommitted files.
