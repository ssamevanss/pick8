---
name: release-readiness
description: Pre-release checklist for a Pick8 deploy (code, migrations, env, cron, rollback). Use when the owner asks whether a branch is ready to ship. Read-only; never deploys.
disable-model-invocation: true
---
# Release readiness (read-only)

Produce a go/no-go with evidence. Do not push, deploy, apply migrations, or call production.

1. **Scope:** `git log main..HEAD --oneline` and `git diff --stat main...HEAD`. Classify: UI-only,
   server logic, scoring/lock rules, migration, dependency, cron/config.
2. **Validation:** run the `validate` skill; require green typecheck/lint/test/build.
3. **Migrations:** list new files in `supabase/migrations/`. For each: additive? RLS + grants? tested
   (PGlite)? Is a backup/restore point recorded in the PR? Is the deploy order stated (migration
   before or after code) and the code safe against the *old* schema during the gap?
4. **Env / config:** diff `.env.example` vs code reads (`grep -rn "process.env\." app utils proxy.ts`).
   New variables must be listed for Vercel Production **and** Preview (see docs/pick8-operations.md).
   Confirm `vercel.json` cron changes are intended (they are production-affecting).
5. **Sensitive areas:** scoring/lock rules, auth/proxy, cron auth, WYG contract — if touched, require
   tests and a rollback note. Check the matchday calendar: avoid releasing during a live matchday or
   in the hour before a first kickoff.
6. **Dependencies:** `npm audit` delta vs baseline; flag new critical/high.
7. **Rollback:** Vercel "Instant Rollback" target (previous deployment) and whether any migration
   makes it unsafe; note data that cannot be un-written.
8. **Post-deploy smoke list** (for the human to run): login, dashboard, my-picks load, admin loads,
   `sync-results` dry observation in logs at next window. Never trigger crons on production yourself.

Output: GO / NO-GO, blocking items, risks accepted, and the exact commands/steps for the human.
