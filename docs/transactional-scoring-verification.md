**Transactional Pick 8 scoring — implementation and verification, 14 September 2026**

Application implementation is local and has not been deployed. Following verification and explicit user authorization, the additive scoring migration was applied to the production Pick8 Supabase project (`wzubbusqitoigmhjcphk`) as `20260914120012_transactional_pick8_scoring`. Read-only catalog checks confirmed the RPC, checkpoint columns, enabled checkpoint guard, and service-role-only RPC execution permissions. The local filename matches the recorded migration version. No production scoring invocation or application deployment was performed.

During implementation, production access was limited to read-only catalog queries to capture the deployed scoring-related triggers. All scoring mutations, failure injection and concurrent test transactions ran in a fresh PostgreSQL 17.6 cluster on localhost.

**What changed**

`score_pick8_matchday` is a service-role-only, SECURITY INVOKER RPC. It captures matchday revision, lifecycle, fixtures, entries and submitted selections in one SQL statement snapshot. It computes the existing rules, applies null-safe updates to changed selection/entry outputs, and stores lifecycle, acknowledged revision and a result checkpoint in one transaction. The unchanged TypeScript pure scoring functions remain the parity reference.

`scored_revision` and `scoring_result` are additive matchday metadata. Their guard prevents ordinary authenticated users, including authenticated admins with table access, from forging scoring checkpoints. The RPC is revoked from PUBLIC, anon and authenticated and checks current_user=service_role. No new RLS-bypassing SECURITY DEFINER endpoint is introduced.

Interim totals and timestamps remain null. Finished selections can have positive, negative or zero points before finalization. Unfinished or void selections remain null. Finished fixtures missing either score retain the existing behavior: their selections are null, but terminal-status final readiness still follows the original rules. Draft entry totals/timestamps are cleared; draft selection outputs are untouched. An already-correct final total and non-null final timestamp are retained, rather than refreshing the timestamp on every recalculation. This is necessary for zero output changes when values are already current.

The application reads the checkpoint, establishes pending if necessary, then issues one non-retried RPC. A lost response causes a bounded checkpoint read-back, not an immediate mutation retry. Revision, pending flag and lifecycle must match before accepting the stored result. Unknown outcomes defer to the next invocation without catch-block writes.

Fingerprint-only recovery reuses an acknowledged scoring revision. The slow-path upsert omits scoring_pending when it does not need to set it true; it never writes a stale false over a concurrent input writer's true. Final fingerprint verification and compare-and-set also require the scorer's acknowledged revision to remain current. The existing clean fingerprint fast path remains intact.

**Concurrency and rollback reasoning**

1. A transaction-scoped advisory try-lock serializes new scorers for one matchday. A concurrent scorer fails promptly with 55P03 and returns a durable deferred outcome.
2. Inputs are captured without locking the parent. One statement supplies a consistent snapshot even at READ COMMITTED.
3. Snapshot entry rows, then snapshot submitted-selection rows, are locked in UUID order with NOWAIT. Scoring does not wait on a child while holding its parent. Existing input writers using another child order cause a prompt rollback, not a wait cycle.
4. Output updates do not dirty scoring inputs under the deployed triggers. All relevant deployed definitions are pinned in `tests/fixtures/pick8-deployed-triggers-20260914.json`, including the extra submission trigger absent from migration history.
5. The matchday row is locked with NOWAIT only after all child output writes. The final UPDATE checks season, revision and original lifecycle. A committed intervening input change makes it fail and rolls back every output. An uncommitted writer holding the parent makes NOWAIT fail. Inputs committing after scoring commit mark the next revision pending normally.
6. A status transition can lock the season through the lifecycle trigger. A 500 ms lock timeout bounds this remaining wait; timeout/deadlock/serialization failures roll back and defer. Deferred constraint failures at transaction commit also roll back outputs and acknowledgement together.

The RPC declares a five-second statement timeout for PostgREST and the client has a five-second RPC timeout. The 25-second outer deadline is unchanged. Admission requires nine seconds remaining after pending is durable, reserving at least four seconds beyond the RPC timeout for read-back/acknowledgement. Insufficient admission returns `ok:true, complete:false, deferred:[...]`, with durable work retained. It does not claim completion. An HTTP abort is not treated as proof of database rollback; checkpoint read-back resolves committed outcomes.

**Verification**

The isolated database applies the repository schema and function migrations, overlays the read-only deployed trigger/function snapshot, and applies the new migration. Two historical production-UUID data repair blocks are excluded from fresh test-cluster setup; their schema and trigger changes are included. Tests never accept a production connection URL.

The PostgreSQL tests cover:

- SQL/TypeScript parity for all seven categories and both selected team sides across scores 0–5 by 0–5, plus draw goals 6–10, 15, 20 and 100. The draw ladder is the original uncapped `15 + home_score` formula.
- Clean sheets, negative totals, unfinished fixtures with and without scores, null scores, postponed/cancelled fixtures, exact Total Goals bonus, drafts, interim/final readiness, empty fixture sets and accelerated-finalization guards.
- A 26-entry / 182-selection final pass and a forced unchanged recalculation with zero selection/entry output updates, including unchanged timestamps.
- Failure during output application, acknowledgement failure, deferred failure at commit, stale revision, absent pending, discarded committed response and idempotent checkpoint reuse.
- Real concurrent fixture input changes, overlapping scorers, child→trigger→parent contention, parent contention at acknowledgement and season lock timeout, all with deployed triggers.
- Fixture correction/removal, service-role permissions, and rejection of ordinary-user checkpoint forgery.

Application orchestration tests additionally cover lost HTTP responses/read-back, unavailable read-back, newer revision protection, admission deferral, fingerprint-only recovery without RPC, the scoring-status fast path and no immediate retry for 55P03/40P01/40001/57014.

**Reproduction**

No PostgreSQL dependency was added to the production application. Install test-only dependencies in a separate directory, then run:

```sh
npm install --prefix /tmp/pick8-pg-tests --save-exact embedded-postgres@17.6.0-beta.15 pg@8.23.0
PICK8_PG_TEST_DEPENDENCIES=/tmp/pick8-pg-tests node --test tests/pick8-scoring-postgres.mjs
PICK8_PG_TEST_DEPENDENCIES=/tmp/pick8-pg-tests node tests/benchmark-pick8-scoring.mjs
npm test
npm run lint
npm run build
```

The PostgreSQL binary package's normal symlink-hydration postinstall must be allowed by npm. Existing PGlite migration tests remain independently runnable using the documented `PICK8_PGLITE_MODULE` setting in `tests/pick8-sync-migration.mjs`.

**Benchmark method and limits**

`tests/benchmark-pick8-scoring.mjs` runs the actual old cron/scorer source at commit `7d31a4e` and the current code through the installed Supabase SDK into real local PostgreSQL. A restricted test transport implements the exercised PostgREST operations, including numeric bigint JSON encoding. It injects 109 ms per SDK request (the production-observed median inter-write gap) and 1.2 seconds for one provider request. These are controlled simulated network costs, not measurements of hosted Supabase/Vercel latency.

The benchmark seeds 26 submitted entries, 182 selections, nine finished fixtures and one timed fixture. The synthetic selections all reference finished fixtures, so entry totals remain null while 182 selection values change. Existing competition rows are present. The existing matchday upsert's BEFORE INSERT lifecycle trigger also dirties competition work on conflict; the full pass therefore includes competition refresh. The benchmark makes this cost visible rather than removing it as an unrelated optimization.

The old full-pass comparison uses a test-only 60-second budget so its entire request count can be measured. A separate old-code run retains the real 25-second budget and demonstrates interruption with pending state retained. New code always uses the real 25-second budget. The benchmark also asserts a subsequent six-request fast path, status scoring and zero output-row changes.

**Final measured results**

All checks passed: 144 application tests, 18 native PostgreSQL test groups (including the parity matrices and real concurrent transactions), 10 existing PGlite migration tests, ESLint, production build and `git diff --check`.

| Controlled 26-entry / 182-selection interim pass | Old full pass | New full pass |
|---|---:|---:|
| Supabase SDK REST/RPC requests | 234 | 20 |
| Selection PATCH requests | 182 | 0 |
| Entry PATCH requests, including draft reset | 27 | 0 |
| Scoring stage | 24.450 s | 0.247 s |
| Total cron | 27.580 s | 3.382 s |
| Selection / entry rows considered | 182 / 26 | 182 / 26 |
| Selection / entry rows physically updated | 182 / 26 | 182 / 0 |
| Selection / entry scoring values changed | 182 / 0 | 182 / 0 |

That is 91.5% fewer total SDK requests, 99.0% less scoring-stage time and 87.7% less total runtime in this controlled test. The new scoring stage uses one checkpoint read and one scoring RPC when pending is already durable, versus 216 old scoring requests.

The old-code run with the actual 25-second budget failed at 25.006 seconds, with both pending flags still true. Only 170 selection and 24 entry row writes committed. The new follow-up invocation completed in 1.888 seconds with six SDK requests, `fastPath=true`, `recalculated=false`, status `scoring`, and zero output changes.

Native PostgreSQL final scoring (without simulated gateway latency) took 6.12 ms for 182 changed selection rows and 26 changed entry rows. A forced unchanged final recalculation took 2.76 ms and changed zero selection/entry outputs or timestamps. These database timings are local measurements, not hosted production promises.

**Remaining deployment risks and sequence**

- Apply the additive migration before deploying callers that select the new columns or call the RPC. There is intentionally no fallback to serial scoring when the RPC is missing.
- Pause/drain old scoring invocations during rollout, including reconciliation and manual scoring. The old implementation does not participate in the new advisory lock and can still publish individual stale writes. Resume scheduling after the new code is active and old scorers have drained.
- Hosted PostgREST timeout configuration, gateway latency and production p95/p99 runtime still require observation after a separately authorized deployment. Local tests verify the transaction/locking behavior; the SDK benchmark does not replace a hosted smoke check.
- Heavy sustained contention can defer work to the next scheduled invocation. Outputs remain atomic; checkpoints prevent false completion. Unknown HTTP outcomes may already have committed and are checked on the next invocation.
- Fixture application remains outside the scoring transaction. UI reads across multiple requests can straddle a fixture/scoring commit; this change makes scoring outputs atomic, not every page's multi-query read snapshot.
- Final scoring timestamps no longer churn when final outputs are unchanged. This is the intentional output-write optimization; all scoring values and interim/final meaning are preserved.
