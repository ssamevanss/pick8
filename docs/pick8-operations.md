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
| `/api/cron/health` | external uptime check, ~10 min (**to be created by the owner**) | cron-job.org | Read-only: 503 if a job is missed/failing |

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
dashboard, and the automation history described below. There is no error tracker and no freshness check on Who You Got data.

### Automation history and health
- Every authenticated call to `sync-results`, `sync-fixtures` and `reconcile-results` writes a row to
  `pick8_cron_executions` (migration `20261103000000`): `running` at start, then `success`, `no_op` (nothing due /
  no active season) or `failure`. **The outcome comes from the response body** (`ok: false`), because business failures
  return HTTP 200. Rejected-auth calls are not recorded, so a scheduler with a wrong secret shows up as *missed*.
  Recording is best-effort and can never change a job's result or status: the start marker is written concurrently with the
  job, completion is recorded in Next's `after()` (so it adds no response latency), and every monitoring write is bounded to 3 s
  with one retry of the idempotent finish write. If `after()` is unavailable the completion is written inline instead.
  The table is RLS-enabled with no policies and no grants to `anon`/`authenticated`; only server code (service role) reads it.
- **Admin page** (`/admin`, "Scheduled jobs"): per-job status, last attempt/success, recent runs, and when monitoring started. Read-only.
- **Health endpoint** `GET /api/cron/health` (same Bearer `CRON_SECRET`; read-only; triggers nothing; no query parameters):
  `200` healthy, `503` otherwise. What turns it red (UTC times; schedules match `vercel.json`, see `PICK8_CRON_SCHEDULES`):

  | Condition | `sync-results` (every ≤5 min) | `sync-fixtures` 02:15 / `reconcile-results` 05:30 |
  |---|---|---|
  | *missed* (no attempt of any outcome) | > 15 min since the last attempt | no attempt from 30 min before the due time until 2 h after it |
  | *failing* | 3 consecutive failed runs | the latest run failed (stays red until the next successful run) |
  | stuck `running` row | counts as one failed run after 10 min | counts as a failed run after 10 min |

  A `no_op` is a healthy run. A failure returned as HTTP 200 (`ok: false`) counts as a failure. A single failed
  `sync-results` run, or one still in flight, never turns it red. Unreadable history is `503` `{"status":"unavailable"}`,
  and an invalid `PICK8_CRON_MONITORING_SINCE` is also `503` (so it cannot silently disarm monitoring).
  Recovery is automatic on the next poll after a successful run (or, for *missed*, any attempt).
- **Activation baseline `PICK8_CRON_MONITORING_SINCE`** (optional env, ISO-8601 *with* a zone, e.g. `2026-11-10T00:00:00Z`):
  nothing is expected before it, and a job with no rows after it is reported *missed* even if the table is empty
  (daily jobs only from a due time ≥ 1 h after it). Set it to the production go-live time. If unset, monitoring arms at
  the first recorded run of any job, so a job that never starts is invisible until then (`/admin` says "not armed").
  Failures recorded before the baseline are ignored. A future value defers all alerting until it arrives.
- **cron-job.org (owner action, not done by the code):** a *separate* job for `https://<prod-host>/api/cron/health`
  with header `Authorization: Bearer <CRON_SECRET>`, every 10 min, timeout 30 s, notify after **≥ 2 consecutive
  failures** and on recovery. A genuine failure therefore alerts 10–20 min after it is detected; a Supabase blip does not.
- **Supabase `JWT issued at future` (PGRST303):** an intermittent Supabase gateway/PostgREST clock-skew rejection of `sb_secret_`
  keys (upstream supabase/supabase#49655, #50651), not an RLS or migration problem. Production saw it on ~2 of 29 `sync-results`
  discovery calls. It is rejected before any SQL runs, so replaying is safe even for writes. Monitoring reads/writes and the
  cron jobs' own database calls (the admin client inside a cron run) replay it after 300 ms and 900 ms; the replay goes back
  through the cron deadline fetch (counted, cancelled with the invocation, skipped when under ~1 s of budget would remain) and
  logs `pick8-cron-monitor` `jwt_skew_retry`, which is how to count it. Nothing else is retried: other 401s, SQL errors, 5xx and
  transport errors keep their existing handling; admin pages/actions (outside a cron run) are unchanged.
- Caveats: pausing the `sync-results` scheduler on purpose (e.g. off-season) turns the check red after 15 minutes. A daily
  run whose finish write is lost is indistinguishable from a killed run and reads as *failing* until the next success.
  Rolling the code back stops new rows and the endpoint, so `sync-results` goes *missed* and the check fails.
- Retention: not automated. A year of history is ≈ 105k rows ≈ 24 MiB with indexes, and every health query is index-bounded
  (verified in `tests/pick8-cron-executions-migration.mjs`). If it is ever wanted:
  `delete from public.pick8_cron_executions where started_at < now() - interval '1 year';`.

### Release order for the monitoring change
1. Back up per "Backups and recovery". Apply migration `20261103000000_pick8_cron_executions.sql` to production (additive; the old code ignores it).
2. In Vercel (Production) set `PICK8_CRON_MONITORING_SINCE` to the planned go-live time (UTC, with `Z`), then merge and deploy.
3. Confirm: `/admin` shows "Scheduled jobs"; within ~10 min `sync-results` rows appear and its status is Healthy; `GET /api/cron/health` with the Bearer header returns 200.
4. After the next `sync-fixtures` (02:15 UTC) and `reconcile-results` (05:30 UTC) runs have recorded, create the cron-job.org health job above.

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
