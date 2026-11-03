---
paths:
  - "app/api/cron/sync-*/**"
  - "app/api/cron/reconcile-results/**"
  - "utils/pick8-cron-automation.ts"
  - "utils/pick8-sync-*.ts"
  - "utils/supabase/cron-read.ts"
  - "utils/supabase/resilience.ts"
  - "utils/who-you-got-fixture-sync.ts"
  - "utils/cron-diagnostics.ts"
  - "utils/server-timing.ts"
  - "vercel.json"
---
# Scheduled jobs and sync

- Jobs: `sync-fixtures` (Vercel, 02:15 UTC), `reconcile-results` (Vercel, 05:30 UTC), `sync-results`
  (external scheduler, ≤ every 5 min, **not defined in the repo**). **Do not change schedules, or call
  these routes against production, without explicit approval.** Keep daily jobs off `:00/:05` boundaries.
- Auth: `authorizePick8Cron` — `Authorization: Bearer $CRON_SECRET` only; 401 missing, 403 wrong,
  fail closed if unset. No query-string secrets. Never log the secret or the header. The check lives in
  `utils/pick8-cron-auth.ts` (SHA-256 + `timingSafeEqual`); rejections emit one throttled
  `{service:"pick8-cron",event:"auth_rejected",route,status,reason}` line (≤1/min per route+reason per instance,
  later lines carry `suppressed`). Reasons: `secret_not_configured` (500, `console.error`), `missing_authorization`
  (401), `malformed_authorization`/`invalid_token` (403).
- Idempotency: same invocation twice must be safe. Cross-instance protection comes from the DB
  (advisory lock in scoring, revision guards, fingerprints); the process-local in-flight guard is only
  best-effort. Don't rely on the latter.
- Writes are never blindly retried; ambiguous outcomes are resolved by read-back (see
  `isAmbiguousWriteResult`). Reads use the bounded budget in `cron-read.ts` (6 s/attempt, 25 s total).
  Don't raise budgets without measuring; no route sets `maxDuration`, so the platform default applies.
- Failures must be isolated per matchday and returned in `failures`; retain pending flags so the next
  run recovers. A no-op outside kickoff windows is correct, not an incident.
- Monitoring: the three job routes run through `monitoredCron` (`utils/pick8-cron-executions-store.ts`), which
  records `pick8_cron_executions` rows; outcome is classified from the response body (`classifyCronResult`), not
  the HTTP status. Recording must stay observational: bounded, swallowed, never retried beyond the idempotent
  finish write, completed in `after()` (off the response path, inline fallback), and never wrapped inside `run*` (the failure-injection harness). Health rules live in the pure
  `utils/pick8-cron-monitor.ts` (activation baseline `PICK8_CRON_MONITORING_SINCE`); `GET /api/cron/health`
  (Bearer, read-only) and the admin "Scheduled jobs" section read them. Changing a schedule or the scheduler
  cadence means updating `PICK8_CRON_SCHEDULES` too (a test compares it with `vercel.json`).
- Keep structured events (`pick8-cron`, `pick8-cron-monitor`, `pick8-sync-stage`, `cron_read`) stable — runbooks and alerts
  key on them. Never include secrets, provider payloads or emails.
- Test with the failure-injection suites (`pick8-sync-integration`, `pick8-cron-read`,
  `pick8-sync-state`) and the PGlite migration test; there is no staging environment.
