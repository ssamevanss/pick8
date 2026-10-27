# Pick8 operations

Facts marked **(unverified)** could not be confirmed from the repository; check them in the Vercel /
Supabase / scheduler dashboards and replace the marker.

## Environment variables
Names and purposes: `.env.example`. Where they live: **Vercel → Project → Environment Variables**, scoped
Production / Preview / Development separately. Server-only: `SUPABASE_SECRET_KEY`, `CRON_SECRET`,
`PICK8_SIGNUP_CODE`, `WHO_YOU_GOT_API_KEY`. `NEXT_PUBLIC_*` values are shipped to browsers.
Rotation: Supabase key → update Vercel, redeploy. `CRON_SECRET` → update Vercel **and** the external
scheduler together. `WHO_YOU_GOT_API_KEY` → change `PICK8_SHARED_API_KEY` in WYG and here together.
Anything that appeared in a URL, chat or log is compromised: rotate it.

## Scheduled jobs
| Route | Schedule | Owner | Purpose |
|---|---|---|---|
| `/api/cron/sync-fixtures` | 02:15 UTC daily | `vercel.json` | Refresh open/scoring/next-3 matchdays, competitions |
| `/api/cron/reconcile-results` | 05:30 UTC daily | `vercel.json` | Re-check recent matchdays; pick up provider corrections |
| `/api/cron/sync-results` | every ≤5 min | external scheduler, cron-job.org **(unverified)** | Live/near-kickoff result sync + scoring |

All require `Authorization: Bearer $CRON_SECRET`. Do not call them against production by hand except as an
owner-approved recovery step; a quiet response with `skipped: true` is normal outside kickoff windows.
Vercel cron only targets the Production deployment, so Preview deployments never run these.

## Symptom → first check
| Symptom | Look at |
|---|---|
| Scores/results stale after a match | `matchdays.last_upstream_check_at`, `sync_pending`, `scoring_pending`; Vercel logs `service:"pick8-cron"`; is the external scheduler still firing (job history)? Then WYG: does its endpoint return the fixture as `finished`? |
| `authentication` errors in sync | `WHO_YOU_GOT_API_KEY` ≠ WYG `PICK8_SHARED_API_KEY` (rotation) |
| `missing_mapping` / `invalid_response` | WYG season mapping or contract change — fail-closed is working; fix WYG, do not patch Pick8 data |
| `scoring_pending` stays true | `pick8-sync-stage` `scoring` failures; RPC 55P03/40P01/40001/57014 are deferred and retried next run |
| Users see "temporarily unavailable" | `pick8-middleware-auth` timeout/error events ⇒ Supabase Auth degraded; nothing to fix locally |
| Wrong score on one entry | Compare `entry_selections.points_awarded` with `/rules`; trigger the admin recalculation (idempotent); never edit scores by SQL |
| Entry changes accepted after kickoff | Treat as a P1: check `matchdays.locks_at` / first fixture kickoff vs DB trigger from migration `20260820010000` |

## Monitoring today
Vercel runtime logs (retention depends on plan **(unverified)**), the external scheduler's job history, Supabase
dashboard. There is no alerting, no error tracker, no uptime monitor, and no admin-visible sync freshness.
Recommended additions: a cron heartbeat (free uptime/heartbeat service), a freshness check on Who You Got data, an admin freshness panel, and a free-tier error tracker.

## Backups and recovery
Current state **(unverified)**: Supabase project plan and backup/PITR status are not recorded anywhere. The
only in-app export (`/admin/maintenance/export`) targets WYG tables and does not export Pick8 data.
Minimum acceptable posture, owner actions:
1. Record the Supabase plan; confirm daily backups (Pro) or PITR; note retention.
2. Before any migration, bulk admin change, or matchday-critical release: take an on-demand backup
   (dashboard) **or** `pg_dump --data-only -t public.entries -t public.entry_selections …` to an encrypted
   file kept off the laptop.
3. Quarterly restore drill into a *scratch* Supabase project (never over production); verify row counts for
   `entries`, `entry_selections`, `matchdays` and that `score_pick8_matchday` reproduces stored scores.
4. Accidental deletion of picks: restore the affected rows from the latest backup into a scratch DB, diff,
   and re-insert only the missing rows via reviewed SQL — then run the admin recalculation. Scores are
   derived data and can always be recomputed from entries + fixtures.
5. Provider returned a wrong result: do **not** edit scores. Fix upstream in WYG (or use the manual-matchday
   isolation for a deliberate override), let `reconcile-results`/`sync-results` re-apply; scoring recomputes.
6. Bad deploy: Vercel Instant Rollback. Bad migration: forward-fix migration; restore only as last resort.
Exposure with no verified backups: up to the entire history of picks and scores. Treat as open until step 1–3 done.

## Environments
Current: one Supabase project is documented and no staging project exists **(unverified in dashboards)**;
the developer's local `.env.local` carries a service-role key, so local runs can write to whatever it points at.
Target: separate free Supabase project for Preview/Development, Vercel Preview env vars scoped
to it, `WHO_YOU_GOT_API_URL` unset or pointed at a stub in Preview so sync fails closed, seeded
manual matchdays (`utils/pick8-manual-test.ts`) for scoring scenarios, Supabase Auth URL allow-list limited
to approved preview URLs. Pick8 sends no application email (only Supabase Auth mail), so there is nothing to
sandbox beyond the staging project's Auth settings.
