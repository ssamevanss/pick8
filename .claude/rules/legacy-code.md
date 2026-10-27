---
paths:
  - "app/api/admin/**"
  - "app/api/predictions/**"
  - "app/api/cron/auto-pick-fixtures/**"
  - "app/api/cron/import-external-fixtures/**"
  - "app/api/cron/refresh-external-fixtures/**"
  - "app/api/cron/refresh-standings/**"
  - "app/api/cron/send-prediction-reminders/**"
  - "app/api/cron/sync-external-results/**"
  - "app/(app)/predictions/**"
  - "app/(app)/pick-fixtures/**"
  - "app/(app)/leaderboard/**"
  - "app/(app)/admin/maintenance/**"
  - "app/league/**"
  - "app/leagues/**"
  - "app/test-supabase/**"
  - "utils/legacy-*.ts"
  - "utils/email*.ts"
  - "utils/external-*.ts"
  - "utils/football-data/**"
  - "utils/supabase/legacy-*.ts"
  - "utils/supabase/route-auth.ts"
---
# Legacy WYG code inside Pick8

These files were inherited from Who You Got and target tables the Pick8 database does not have.
They are not used by the Pick8 product (nav: Dashboard, My Picks, Tables, Rules, Admin).

- Do **not** add features, fix cosmetic issues, or build on them. Don't import from them in new code.
- They are still reachable URLs and use older, weaker auth patterns than the live routes. Never copy them;
  cron routes must use `authorizePick8Cron`, pages/actions must use `getRequestAuthContext` with `is_admin`/`is_active`.
- Safe changes: deleting a route, redirecting it, or making it return 404, each in its own PR with
  `npm run build` proof that nothing live imports it. Confirm with the owner first, and never touch
  the production schema as part of it.
- Never send email from here (`utils/email*.ts` still hard-code WYG's production URL and Resend).
