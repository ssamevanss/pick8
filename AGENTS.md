<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Pick8 — agent guide

Pick8 is a **private Premier League matchday prediction game**. Players pick fixtures into
eight scoring categories (seven for matchdays 1–5) and predict the matchday's Total Goals.
It runs on Next.js 16 (App Router, `proxy.ts` instead of `middleware.ts`), React 19,
Tailwind 4, Supabase (Auth + Postgres) and Vercel. It is the sibling of **Who You Got**
(WYG), a separate app in `../Football_Predictor/football-predictor`.

Detail lives in `docs/`: start at [docs/README.md](docs/README.md). This file is the contract;
`.claude/rules/*.md` add area-specific rules that load when you touch those paths.

## Source of truth (read this before trusting any doc)

1. **Code and `supabase/migrations/`** — authoritative.
2. `docs/ARCHITECTURE.md`, `docs/pick8-operations.md`, `docs/DEVELOPMENT.md`, this file — current.
3. `docs/OPERATIONS.md`, `PROJECT_CONTEXT.md`, `RELEASE_CHECKLIST.md`, `ROADMAP.md`,
   `DATABASE_SCHEMA.md`, `FUTURE_*`, `2.0*`, and the dated `docs/2026-*.sql` files were
   inherited from WYG. Only the Pick8 sections of `OPERATIONS.md` are current, and some
   of those predate transactional scoring. Never apply `docs/*.sql`; Pick8 schema changes
   go only in `supabase/migrations/`.

## Architecture in one screen

- **Own Supabase project** (verified: different from WYG's). Tables: `profiles`, `seasons`,
  `competitions`, `matchdays`, `fixtures`, `entries`, `entry_selections` (see `types/database.types.ts`).
- **Live routes:** `/login /signup /forgot-password /reset-password /auth/callback`, `/dashboard`
  (home; `/` redirects), `/my-picks`, `/tables`, `/rules`, `/settings`, `/admin`, and
  `/api/cron/{sync-fixtures,sync-results,reconcile-results}`.
- **Football data:** Pick8 never calls a football provider for its live game. It pulls fixtures
  per `(season, matchday)` from WYG `GET /api/shared-football/fixtures` using
  `WHO_YOU_GOT_API_URL` / `WHO_YOU_GOT_API_KEY` (`utils/who-you-got-fixture-sync.ts`).
  See `.claude/rules/who-you-got-integration.md`.
- **Data access:** `utils/supabase/server.ts` (cookie session, RLS), `admin.ts` (service role,
  typed — `createAdminClient`, `createInteractiveAdminClient` for pages), `cron-read.ts`
  (bounded reads/deadline for the result cron). `legacy-*.ts` and `route-auth.ts` target the
  old WYG schema.
- **Automation:** Vercel cron → `sync-fixtures` (02:15 UTC) and `reconcile-results` (05:30 UTC);
  `sync-results` (every ≤5 min) is triggered by an **external scheduler (cron-job.org per docs;
  not visible in this repo — verify before relying on it)**. Orchestration in
  `utils/pick8-cron-automation.ts`; auth is `Authorization: Bearer $CRON_SECRET` only.
- **Scoring:** computed in Postgres by `score_pick8_matchday` (transactional, advisory-locked,
  revision-guarded) via `utils/pick8-scoring.ts`. TypeScript rules in `utils/pick8-scoring-rules.ts`
  must stay identical to SQL.

## Legacy (inherited from WYG) — do not extend

Retained but not part of the Pick8 product and written for a schema the Pick8 database does not have
(`gameweeks`, `predictions`, `leaderboard_entries`, `profiles.role/status`, …): `/predictions`,
`/pick-fixtures`, `/leaderboard`, `/league*`, `/leagues*`, `/test-supabase`, `/admin/maintenance/export`,
`/api/admin/*`, `/api/predictions/*`, the six non-Pick8 `/api/cron/*` routes, `utils/legacy-*`,
`utils/email*.ts`, `utils/external-*`, `utils/football-data/`, `utils/supabase/{legacy-*,route-auth}.ts`.
Don't add features there. Removal is a tracked roadmap item; until then treat them as attack surface
(see `.claude/rules/legacy-code.md`).

## Business rules (do not change without explicit instruction)

- **Season/matchdays:** 38 matchdays per season; competitions are fixed ranges 1–5, 6–10, 11–15,
  16–20, 21–25, 26–30, 31–35, 36–38. Matchday `status`: `upcoming → open → scoring → completed`.
- **Entry:** a *draft* may be incomplete; a *submitted* entry needs every category on distinct
  fixtures plus Total Goals. Rules version is per matchday (`pick8_rules_version`): v1 (matchdays 1–5)
  has 7 categories; v2 adds `btts`.
- **Lock:** the *whole entry* (selections and Total Goals, drafts and edits) locks at the matchday's
  **first fixture kickoff**. Other players' selections become visible only after *that selection's
  fixture* kicks off; drafts are always private.
- **Scoring (finished fixtures only):** Home Winner win `5 + GD`, loss `−5 × GD`; Away Winner win
  `10 + GD`, loss `−5 × GD`; correct Draw `15 + home goals`; Team Win/Lose/Score, Clean Sheet, BTTS
  `+10` right / `−10` wrong; Total Goals exact `+10` else `0`. Postponed/cancelled fixtures are void
  (0 points, excluded from Total Goals). Final matchday scoring happens only when every fixture is
  finished/postponed/cancelled; provider corrections trigger recalculation.
- **Participation:** `profiles.is_active` (account) and `pick8_participation_active` (may enter).
  Display time zone is `Australia/Melbourne` (`PICK8_TIME_ZONE`); stored times are UTC.

## Conventions

- TypeScript strict; `@/` imports the repo root. Server-only modules start with `import "server-only"`.
- Modules unit-tested directly by `node --test` (pure logic in `utils/pick8-*.ts`) use **relative
  `.ts` imports**, not `@/`. Match the neighbouring file.
- Match the existing dense style; do not reformat unrelated code (no Prettier by design; ESLint only).
- Never log or return secrets, emails, or raw provider payloads. Structured logs are one-line JSON
  with a `service` field (`pick8-cron`, `pick8-sync-stage`, `pick8-middleware-auth`, …).
- Schema changes: additive timestamped file in `supabase/migrations/`, RLS + explicit grants, and a
  test. Never rename or edit a migration that may be applied (a test had already drifted from a migration filename).
- Don't add dependencies without a stated reason; no large framework upgrades inside feature work.

## Validation (run before claiming done)

```bash
npm run check           # typecheck (app) + lint + unit tests
npm run build           # needs the env in .env.example (placeholders are fine)
npm run typecheck:tests # known failing today: 40 test-only type errors (docs/DEVELOPMENT.md)
```

DB-level tests are opt-in: `tests/pick8-sync-migration.mjs` (`PICK8_PGLITE_MODULE=…/pglite/dist/index.js`)
and `tests/pick8-scoring-postgres.mjs` (`PICK8_PG_TEST_DEPENDENCIES`, needs embedded-postgres). Run them
for any change to migrations, scoring or sync state. Scheduled/production behaviour can't be validated
locally: say so rather than implying it.

## Safety boundaries

- Never read, print or commit `.env*`. Use `.env.example` for names. Production values live in Vercel
  and Supabase only.
- Don't touch production data, configuration, cron schedules, or the sibling repo from a task here.
  Don't trigger cron routes against production, send email, or run restores/destructive SQL.
- No `git push`, merge, PR, or deploy without explicit approval. Branch/PR/release procedure:
  `docs/DEVELOPMENT.md`.
- Don't weaken: Bearer-only cron auth, fail-closed auth/timeouts (`utils/supabase/resilience.ts`,
  `middleware-auth.ts`), manual-matchday isolation, revision-guarded idempotent scoring, entry lock.
