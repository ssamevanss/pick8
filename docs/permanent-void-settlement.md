# Permanent void settlement (postponed, replayed and interrupted fixtures)

Status: implemented in migration `20261102000000_pick8_permanent_void_fixtures.sql`. This replaces "Part 4" of
[postponed-and-interrupted-fixtures.md](postponed-and-interrupted-fixtures.md), whose findings still explain why it was needed.

## Policy

If a fixture is postponed to another date, or abandoned and must be replayed, the original predictions on it are void
**permanently**: the fixture scores nothing for anyone, its goals never count towards Total Goals, the matchday completes on
the remaining fixtures, and nothing the provider sends later (a new date, a replay, a score) can bring it back. Players
locked in against one set of circumstances; a match played days later is a different match.

## Root cause

Void was a *status*, not a decision. Pick8 mirrors the provider, so a postponed fixture was void only while the provider said
`postponed`. A reschedule flipped it to `timed` with a new kickoff, which un-voided it, held the matchday for weeks,
blanked every entry's `calculated_score` (the matchday vanished from standings) and changed the Total Goals target
retroactively. SUSPENDED/ABANDONED were worse: served as `cancelled`, they were void at once although a suspended match
normally resumes.

## Design

`fixtures.voided_at` / `void_reason` (`postponed | rescheduled | abandoned | manual`) are an overlay on the provider mirror.
`status`, `kickoff_at` and scores keep following the provider exactly, so sync fingerprints and verification are unchanged.

* **Scoring** (`score_pick8_matchday`, and the TypeScript oracle `pick8-scoring.ts`): a voided fixture is void whatever its
  status, is terminal, scores nothing, adds no goals, and its (new) kickoff does not hold the matchday open.
* **The decision** is a `BEFORE INSERT OR UPDATE` trigger on `fixtures` (`decide_pick8_fixture_void`), so it is taken in the
  same statement that stores the provider data. It cannot be skipped, reordered or lost between a sync and a scoring run.
  `utils/pick8-fixture-void.ts` is its TypeScript mirror (the sync test stand-in and the test oracle); the Postgres test
  compares them over a grid of every status, kickoff move and lock state.
* **Irreversible**: once set, the trigger restores `voided_at`/`void_reason` on every later update, including from the
  service role. Only a migration or a superuser disabling the trigger can undo it. Clients (authenticated role) cannot write it.
* **Display** (`withEffectiveFixtureStatus`) shows a voided fixture as postponed/void on the dashboard, tables and My Picks.
* **Cadence**: discovery (`discover_pick8_due_work`) treats a voided fixture as terminal and ignores its new date, so a
  completed matchday is re-read daily and not every five minutes while a replay is pending. It also returns the voided
  external ids, so the cron path needs no extra read.

## Exactly when a fixture becomes void

All of these apply to provider matchdays only (manual and accelerated-test matchdays are untouched).

| Rule | Trigger | Reason |
| --- | --- | --- |
| Postponed | the provider reports `postponed` for a match that had not started (any time, before or after the entry deadline) | `postponed` |
| Moved to another day | **after the entry deadline**, a match that had not started has its kickoff moved to a later **calendar day** (Europe/London) | `rescheduled` |
| Abandoned and replayed | the same move, from an `abandoned` fixture | `abandoned` |
| Owner decision | `select public.void_pick8_fixture('<fixture uuid>')` (service role) | `manual` |

Not decided:

* a kickoff delay within the same London day (the same scheduled match, e.g. 15:00 to 17:30);
* any move **before** the entry deadline (entries can still be revised);
* a move earlier;
* a started or finished match (`in_play`, `paused`, `finished`) is never voided by a kickoff change or a `postponed` blip;
* plain `cancelled`: it is void while the provider says so, but not decided, because Who You Got also served SUSPENDED and
  ABANDONED as `cancelled` and a provider correction (`cancelled` -> `finished`) must still re-score.

Why a calendar day rather than an hour threshold: it is explainable to players ("same day or a different day"), needs no
magic number, and a delay long enough to cross midnight is a postponement in all but name. The provider gives no field that
says "new date" versus "delay", so the stored kickoff is compared with the incoming one.

## Suspended and abandoned matches

Who You Got keeps `status: "cancelled"` for SUSPENDED/ABANDONED (old Pick8 versions keep working) and adds the optional
`providerStatus` field. Pick8 stores a `cancelled` fixture with `providerStatus` SUSPENDED/ABANDONED as `suspended` /
`abandoned`: **held, not void and not terminal**. The matchday waits.

* resumes (`in_play`, `finished`, `AWARDED`) with the same kickoff: scored normally, never voided;
* moved to a later day (a replay) or reported postponed: void permanently;
* never resolved: the matchday stays in `scoring`. There is deliberately **no automatic deadline**. See "Decisions for the owner".

A producer that does not send `providerStatus` is handled exactly as before (SUSPENDED/ABANDONED appear as `cancelled` and are
void while the provider says so). Do not enable the Who You Got change until this migration is applied (see order below).

## Effects

| Concern | Behaviour |
| --- | --- |
| Points | void picks: `points_awarded` and `is_correct` are `null`, shown as Void |
| Total Goals | only non-void finished fixtures count; a replayed score never does |
| Matchday | completes when every fixture is finished or void; a void fixture's new date does not hold it |
| Completed matchdays | stay `completed`; entry `calculated_score` / `score_calculated_at` are not rewritten; standings do not move |
| Corrections | a correction to a non-void finished fixture re-scores as before |
| Entry deadline | unchanged: `matchdays.locks_at` can only move earlier after it passes (#15). The sync now computes the same protected deadline, so rescheduling the **earliest** fixture after the lock no longer makes verification fail |
| Existing data | nothing is backfilled. A fixture that is `postponed` today becomes void the next time its row changes (including its reschedule) |

## Deployment order (nothing here has been applied or deployed)

1. **Pre-flight (read-only, production):** compare the deployed definitions this migration re-creates with the repo, and look
   for in-flight cases.
   ```sql
   -- must match the latest repo definitions (btts v2 / due-state migrations) before applying
   select md5(pg_get_functiondef('public.score_pick8_matchday(uuid,uuid,bigint,boolean)'::regprocedure));
   select md5(pg_get_functiondef('public.discover_pick8_due_work(text,timestamptz,integer)'::regprocedure));
   select conname from pg_constraint where conrelid = 'public.fixtures'::regclass and conname = 'fixtures_status_check';
   -- fixtures that are postponed/cancelled/suspended-looking now, and matchdays already reopened by a reschedule
   select m.matchday_number, m.status, f.external_fixture_id, f.status, f.kickoff_at
   from public.fixtures f join public.matchdays m on m.id = f.matchday_id
   where f.status in ('postponed','cancelled') or (m.status = 'scoring' and f.status in ('timed','scheduled') and f.kickoff_at > m.locks_at + interval '1 day')
   order by m.matchday_number;
   ```
2. **Merge the Pick8 PR first** (it ships the consumer code and the vendored contract), then apply the migration, then deploy.
   The migration is additive; the new code needs the new columns, and the old code ignores them, so apply the migration
   before (or together with) the deploy.
3. **Then** merge and deploy the Who You Got PR (`providerStatus`). Its CI checks out Pick8 `main` and compares contract
   copies, so it stays red until step 2's merge.
4. Only after 3, SUSPENDED/ABANDONED matches are held. Before it they behave exactly as today.

`create or replace` re-creates `score_pick8_matchday` and `discover_pick8_due_work` from their latest repo definitions, with
only the void changes; `fixtures_status_check` is dropped and re-added with two more values (a metadata change on a few hundred rows).

## Owner runbook

* **Resolve a stuck suspended/abandoned fixture:** `select public.void_pick8_fixture('<fixture id>');` (service role, idempotent,
  final). The next scoring run completes the matchday. Find candidates with
  `select m.matchday_number, f.id, f.status, f.kickoff_at from fixtures f join matchdays m on m.id=f.matchday_id where f.status in ('suspended','abandoned');`
* **A void was wrong:** there is no inverse by design. Disable `fixtures_decide_permanent_void`, clear the two columns for that row,
  re-enable the trigger, and let scoring run, in one reviewed SQL session.
* **Players asking why a fixture is void:** `void_reason` says why; `/rules` states the policy.

## Decisions for the owner

1. **Unresolved SUSPENDED/ABANDONED.** Held indefinitely until the provider resolves it or `void_pick8_fixture` is run. Who You Got
   rechecks them for 14 days after kickoff, then stops. A 14-day (or other) automatic void was not invented because nothing in the
   provider data justifies a number; choose one if holding a matchday is worse than a possibly wrong void.
2. **A fixture re-dated before the entry deadline without the provider ever reporting `postponed`.** Players may still pick it (they know
   the new date) and, if the new date is weeks away, it holds its matchday until played. One reported `postponed` first is already
   void for good. If this happens, run `void_pick8_fixture`; or say that a pre-deadline move beyond some distance should void it.
3. **Existing in-flight cases** (matchdays already reopened by an earlier reschedule) are left alone. Say if any should be settled
   under the new policy (`void_pick8_fixture` per fixture).
4. **`POSTPONED` is trusted at once.** A provider flapping POSTPONED then back to the same day would void a match that is played.
   Football-data does not use POSTPONED for short delays, but that is not verifiable here.

## Verifying

```bash
npm run check
# one-off, outside the repo: npm i embedded-postgres@17.6.0-beta.15 pg
PICK8_PG_TEST_DEPENDENCIES=/path/to/deps node --test tests/pick8-permanent-void-postgres.mjs tests/pick8-postponed-fixtures-postgres.mjs tests/pick8-scoring-postgres.mjs
```
