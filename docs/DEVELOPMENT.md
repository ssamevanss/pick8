# Development, review and release

## Setup
Node ≥ 22.6 (developed on 26.4; CI uses 24 — unverified until the first CI run). `npm ci`, copy `.env.example`
to `.env.local`. **Point local/Preview at a non-production Supabase project** (see pick8-operations.md
"Environments"); do not use production service-role keys for development.

## Validation
| Command | What it proves | State at 2026-10-27 (base `320009c`) |
|---|---|---|
| `npm run typecheck` | App code type-checks (`tsconfig.json` excludes `tests/`, so `next build` ignores test types too) | pass |
| `npm run lint` | ESLint (next core-web-vitals + TS) | pass |
| `npm test` | 164 node:test tests (state, sync, resilience, auth middleware, locks) | pass |
| `npm run build` | Production build, also from a clean checkout with placeholder env | pass |
| `npm run typecheck:tests` | Types incl. tests | **fails: 40 errors**, all in `tests/` (union narrowing of the sync result in `pick8-sync-integration` 20, `pick8-state` 10, `pick8-draft-feedback` 9 [uncommitted WIP], `pick8-interactive-resilience` 1) |
| PGlite migration test (opt-in) | Sync/due-state migrations + triggers on a real Postgres engine | pass (11) once the stale migration filename in the test was fixed |
| `tests/pick8-scoring-postgres.mjs` (opt-in) | SQL scorer == TS oracle, concurrency, failure injection | **not run**: needs `embedded-postgres` (not installed) |

Not covered by any automated test: auth flows end-to-end, RLS policies as `authenticated`/`anon`, admin
actions, pages/components, email, Vercel/cron wiring. The WYG contract is covered by `tests/pick8-wyg-contract.test.ts` (shared fixture; see `.claude/rules/who-you-got-integration.md`).

## Branches, PRs, review
- `main` is production. Work on `feat/…`, `fix/…`, `chore/…` branches; one concern per PR, ideally < 400 changed lines.
- Fill in the PR template (risk area, validation, migration order, rollback). CI (`.github/workflows/ci.yml`) must be green.
- Review rule of thumb: anything touching scoring/lock rules, migrations, auth/proxy, cron auth, or the WYG
  parser needs the owner's explicit review and a test. Prefer squash merge with a descriptive title.
- Never commit `.env*` (except `.env.example`), keys, or production data. Rotate any secret that is ever pasted
  into a chat, ticket or log.
- Branch protection (recommended, owner action): require CI + 1 approval on `main`, block force-push.

## Release procedure
1. Merge to `main` only when CI is green and the release-readiness checklist (`/release-readiness`) is GO.
2. **If a migration is included:** take/confirm a backup point first; apply the migration to staging, then
   production (Supabase SQL editor or CLI), *before* deploying code that needs it; code must tolerate the old
   schema during the gap. Record the migration timestamp in the PR.
3. Avoid deploying within an hour before a matchday's first kickoff or while fixtures are live.
4. Vercel is presumed to deploy `main` via its Git integration (not verifiable from the repo; confirm in the Vercel dashboard). Watch runtime logs for `pick8-middleware-auth`, `pick8-cron` errors
   through the next `sync-results` window.
5. **Rollback:** Vercel Instant Rollback to the previous deployment (code only). Migrations are not rolled back
   automatically — write a compensating forward migration; restores follow pick8-operations.md.
