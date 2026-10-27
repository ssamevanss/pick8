---
paths:
  - "utils/pick8-scoring*.ts"
  - "utils/pick8-rules.ts"
  - "utils/pick8-matchday-*.ts"
  - "utils/pick8-entry-*.ts"
  - "utils/pick8-fixture-*.ts"
  - "utils/pick8-selection-display.ts"
  - "utils/provisional-scoring.ts"
  - "app/(app)/my-picks/**"
  - "app/(app)/admin/score-actions.ts"
  - "supabase/migrations/*scoring*.sql"
---
# Scoring, locking and matchday state

- Points table and lock/visibility rules are in AGENTS.md "Business rules". They are user-visible
  (`/rules`) and money-adjacent for the group: **do not change them without an explicit instruction**.
- Scoring exists twice: SQL (`score_pick8_matchday`, authoritative for stored scores) and TypeScript
  (`pick8-scoring-rules.ts`, used for provisional/live display and as the test oracle). Keep them
  identical; `tests/pick8-scoring-postgres.mjs` compares them.
- Scoring must stay idempotent and revision-guarded: mark pending → read → write → clear only if the
  revision still matches. Never write scores outside that path; never "fix" a score by hand-editing
  `calculated_score`/`points_awarded`.
- Only `finished` fixtures with final scores score. `postponed`/`cancelled` are void (0 pts, excluded
  from Total Goals). Final (matchday-level) scoring requires every fixture terminal.
- Lock = first kickoff of the matchday, enforced in `runPick8EntryWriteWhileOpen` *and* the DB.
  Compare instants (`Date.parse`), never local-time strings. Don't introduce per-fixture entry
  locking without a product decision (WYG locks per fixture; Pick8 intentionally doesn't).
- Provider corrections after completion must re-open scoring through the fingerprint/revision
  mechanism (`pick8-sync-state.ts`), not a special case.
- New category or rules version ⇒ new migration + `pick8_rules_version` handling + `/rules` copy +
  oracle and DB tests (see how `btts` / v2 was added).
