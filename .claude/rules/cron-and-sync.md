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
  fail closed if unset. No query-string secrets. Never log the secret or the header.
- Idempotency: same invocation twice must be safe. Cross-instance protection comes from the DB
  (advisory lock in scoring, revision guards, fingerprints); the process-local in-flight guard is only
  best-effort. Don't rely on the latter.
- Writes are never blindly retried; ambiguous outcomes are resolved by read-back (see
  `isAmbiguousWriteResult`). Reads use the bounded budget in `cron-read.ts` (6 s/attempt, 25 s total).
  Don't raise budgets without measuring; no route sets `maxDuration`, so the platform default applies.
- Failures must be isolated per matchday and returned in `failures`; retain pending flags so the next
  run recovers. A no-op outside kickoff windows is correct, not an incident.
- Keep structured events (`pick8-cron`, `pick8-sync-stage`, `cron_read`) stable — runbooks and alerts
  key on them. Never include secrets, provider payloads or emails.
- Test with the failure-injection suites (`pick8-sync-integration`, `pick8-cron-read`,
  `pick8-sync-state`) and the PGlite migration test; there is no staging environment.
