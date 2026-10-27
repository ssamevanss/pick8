---
name: incident-investigation
description: Investigate a Pick8 production problem (stale fixtures, stuck scoring, wrong score, sync/cron failure, login outage) from code, logs the user provides, and read-only queries. Use when something looks wrong in production.
---
# Incident investigation

Goal: a diagnosis and a safe recovery proposal. **Read-only.** No production writes, restores, cron
triggers, or schema/config changes; propose them for the owner to run.

1. **Frame:** what is wrong, since when, which matchday/fixture/user, what "correct" is. Get the
   matchday number and the provider's/real result for the fixture.
2. **Classify** using `docs/pick8-operations.md` ("Symptom → first check"): provider/WYG freshness,
   sync pending, scoring pending, lock/visibility, auth outage, deploy regression.
3. **Evidence order:** (a) ask for Vercel runtime logs filtered by `service:"pick8-cron"`,
   `pick8-sync-stage`, `cron_read`, `pick8-middleware-auth` for the window; (b) matchday row state
   (`sync_pending`, `scoring_pending`, `sync_revision` vs `scored_revision`, `last_upstream_check_at`,
   `applied_fixture_fingerprint`); (c) the fixture rows vs WYG's endpoint response; (d) recent deploys
   and migrations. Redact emails/tokens when quoting.
4. **Reason from the code:** read the relevant `utils/pick8-*` module and its tests rather than guessing;
   cite file:line.
5. **Recovery proposal:** prefer the existing safe levers — wait for the next `sync-results` window,
   the admin "sync/recalculate" actions (idempotent), or `reconcile-results`. Anything else (SQL, manual
   fixture edit, restore) needs a written plan with a backup/PITR point and a rollback; present it, don't run it.
6. **Close out:** root cause, blast radius (which players/matchdays), fix, and a follow-up test or
   alert that would have caught it.
