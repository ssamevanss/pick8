---
paths:
  - "supabase/**"
  - "types/database.types.ts"
  - "utils/supabase/admin.ts"
  - "tests/pick8-sync-migration.mjs"
  - "tests/pick8-scoring-postgres.mjs"
---
# Database and migrations

- Only `supabase/migrations/*.sql` define the schema. `docs/*.sql` are WYG-era; never apply them.
- New migration = new timestamped file, additive and idempotent where possible, wrapped in a
  transaction. Never edit or rename a migration that may already be applied to production, and never
  apply anything to production from this repo without explicit approval (backup first).
- Every table keeps RLS enabled. Functions are `security definer` with `set search_path = ''` and
  `revoke all … from public, anon, authenticated` followed by an explicit `grant` to the roles that need
  them (the existing scoring/sync functions are the pattern). Explicitly grant table privileges too.
- Entry/selection write rules (first-kickoff lock, distinct fixtures, completeness) are enforced by
  triggers/RLS in the database as well as in TypeScript. Change both together and add tests.
- After a schema change regenerate/update `types/database.types.ts` (no Supabase CLI link exists in
  the repo; hand-edit carefully or generate from a local DB) and run `npm run check`.
- Validate DB logic with the opt-in PGlite/Postgres tests (see AGENTS.md). Scoring/sync state
  migrations must keep `tests/fixtures/pick8-deployed-triggers-*.json` consistent with production.
- Confirm drift with `supabase migration list` / dashboard before and after a release; the repo
  cannot prove what production has applied.
