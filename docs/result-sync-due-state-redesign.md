# Pick 8 result-sync due-state redesign

Status: implemented locally; do not deploy until the migration and application
rollout below have been reviewed together.

## Due-state policy

`discover_pick8_due_work` is the shared bounded discovery function for the
five-minute result sync, daily fixture sync, and daily reconciliation. It
returns active-season metadata and only selected matchdays; it never returns
fixture rows.

- Provider freshness: `next_provider_check_at <= now`, or a bounded bootstrap
  condition around a live/recent matchday. Fixture-application recovery is a
  separate reason and does not by itself make the provider due.
- Local scoring recovery: `scoring_pending`; this runs the existing
  `score_pick8_matchday` RPC without contacting WhoYouGot when provider
  freshness and fixture application are not independently due.
- Fixture application recovery: `fixture_application_pending` (with
  `sync_pending` retained as a rollout compatibility mirror). Fixture writes
  set it; entry and selection writes do not. A durable
  `provider_content_fingerprint` allows an interrupted acknowledgement to be
  recovered from local fixture state without another provider request.
- Competition/lifecycle recovery: the season's existing
  `competition_refresh_pending` / `competition_refresh_after` checkpoint.

After a valid provider response, the next check is scheduled from lifecycle:

| State | Next provider check |
| --- | --- |
| live, scoring, or imminent | 5 minutes |
| terminal, awaiting unchanged confirmation | 15 minutes |
| terminal fingerprint confirmed | 24 hours |
| future kickoff within 24 hours | 1 hour |
| other future round | 6 hours |

A changed terminal fingerprint clears confirmation and returns to the short
confirmation cadence. Therefore completed matchdays retain correction checks
without remaining on the five-minute schedule indefinitely.

WhoYouGot's existing single-matchday contract is unchanged. Pick 8 sends
`If-None-Match` when WhoYouGot previously exposed an `ETag` or
`X-Content-Version`, and handles `304 Not Modified`. The due-work result is an
array boundary, so a future shared-endpoint batch request can replace the
per-matchday provider call without changing discovery or local-recovery policy.

## Request-count baseline and target

The deterministic integration harness records SDK requests.

| Scenario | Old Pick 8 DB | New Pick 8 DB | Old WhoYouGot | New WhoYouGot |
| --- | ---: | ---: | ---: | ---: |
| nothing due | 3 | 1 | 0 | 0 |
| one due, unchanged | 6 | 2 (discovery and state CAS) | 1 | 1 |
| local scoring recovery, provider not due | 6 | 3 (discovery, checkpoint read, scoring RPC) | 1 | 0 |
| one changed provider fixture | 10+ (including per-fixture writes) | bounded; changed fixtures use one bulk upsert | 1 | 1 |
| terminal confirmed | 6 every five minutes | 1 until the 24-hour correction check | 1 | 0 |
| future matchday | broad season reads | 1 until its lifecycle cadence is due | 0–1 | 0 |

### Local benchmark results

The controlled benchmark uses real PostgreSQL, the real scorer/orchestrator,
26 entries and 182 selections. With 5 ms injected per Supabase request and
10 ms for WhoYouGot, the changed/scoring run fell from 234 DB requests and
1.708 s to 16 DB requests and 114 ms. The following idle invocation used one
DB request, no provider request, and 9 ms. The scoring RPC itself remained
unchanged and measured 5.5 ms for 182 selections (2.4 ms for an unchanged
repeat) in the isolated PostgreSQL run.

The deterministic scenario suite records these redesigned-path timings on this
machine; they are regression measurements, not hosted latency predictions:

| Scenario | Old DB | New DB | Old WYG | New WYG | Old runtime | New test runtime |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| nothing due | 3 | 1 | 0 | 0 | within observed 3–7 s job range | 110 ms |
| one due unchanged | 6 | 2 | 1 | 1 | within observed 3–7 s job range | 48 ms |
| local scoring recovery | 6+ | 3 | 1 | 0 | within observed 3–7 s job range | 38 ms |
| one changed provider fixture | per-fixture, 10+ | bounded bulk path | 1 | 1 | within observed 3–7 s job range | 41 ms |
| terminal confirmed | 6 per poll | 1 | 1 per poll | 0 | within observed 3–7 s job range | idle-path 110 ms |
| future matchday | 3 | 1 | 0 | 0 | discovery-only | 36 ms |
| daily fixture sync | broad matchday discovery + per-round application | one due-state read + selected rounds | per selected round | per selected round | environment-dependent | covered by shared-path tests |
| daily reconciliation | 6 | 2 | 1 | 1 | within observed 3–7 s job range | 33 ms |

The old scenario-specific hosted runtimes were not reproducible locally without
deploying old production dependencies; the table therefore keeps the supplied
3–7 second observation instead of presenting invented precision.

Hosted request latency is environment-dependent. Use the benchmark script and
the `pick8-sync-stage`, `pick8-provider-call`, `pick8-due-discovery`,
`pick8-cron`, and `pick8-cron-read-summary` events for measured runtime and
request counts. The latter now includes every Supabase HTTP request made in a
cron context, including mutations and RPC calls.

## Concurrency and recovery

Provider application is acknowledged only after a local fingerprint read-back
and a `sync_revision` compare-and-set. A concurrent fixture writer increments
that revision, so stale workers cannot clear application recovery. Scoring uses
the unchanged transactional RPC and its independent `scoring_revision`,
advisory lock, durable result, and ambiguous-response read-back. A concurrent
entry or selection edit can invalidate scoring without invalidating the already
applied provider fingerprint. Daily fixture sync can therefore acknowledge
provider application while leaving local scoring pending for the next worker.

## Legacy route retirement plan

The repository contains six pre-redesign cron routes:

- `/api/cron/import-external-fixtures`
- `/api/cron/refresh-external-fixtures`
- `/api/cron/sync-external-results`
- `/api/cron/auto-pick-fixtures`
- `/api/cron/refresh-standings`
- `/api/cron/send-prediction-reminders`

None appears in `vercel.json`; the checked-in production documentation names
`/api/cron/sync-results` as the externally owned five-minute schedule. This is
repository evidence, not proof of third-party scheduler ownership, so these
routes are deprecated candidates and are not deleted in this change.

Safe retirement sequence:

1. Inventory Vercel, cron-job.org, and any other scheduler/API consumers.
2. Add per-route invocation counters and observe at least one full fixture and
   reminder cycle.
3. Move any remaining responsibility to an explicitly owned current route.
4. Return deprecation warnings for one release, then `410 Gone` while retaining
   logs.
5. Delete routes and their legacy-only utilities in a separate reviewed commit.

## Local rollout sequence and risks

1. Back up matchday sync metadata and apply the additive migration.
2. Deploy application code immediately after the migration; do not reverse the
   order because the new discovery RPC and columns are required at startup.
3. Run dry/local checks for no-work, unchanged, changed, local-only, terminal,
   daily fixture, and reconciliation paths.
4. Observe due reasons, DB/provider counts, deferred work, and next check times.
5. Only then enable the normal five-minute external call.

Primary risks are migration/application version skew, a WhoYouGot implementation
that emits unstable ETags, unexpected old `sync_pending` writers, and a cadence
that is too slow for late corrections. The compatibility mirror and daily
reconciliation limit those risks; do not remove `sync_pending` until old writers
and legacy routes are retired.
