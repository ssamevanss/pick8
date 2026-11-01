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

`fixtures.voided_at` / `void_reason` (`postponed | rescheduled | abandoned | expired | manual`) are an overlay on the provider mirror.
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
* **Expiry** (`settle_expired_pick8_interrupted_fixtures`): time passing is not a provider update, so the 14 day rule for
  unresolved suspended/abandoned fixtures is a separate local function. See "Suspended and abandoned matches".
* **Cadence**: discovery (`discover_pick8_due_work`) treats a voided fixture as terminal and ignores its new date, so a
  completed matchday is re-read daily and not every five minutes while a replay is pending. It also returns the voided
  external ids, so the cron path needs no extra read.

## Exactly when a fixture becomes void

All of these apply to provider matchdays only (manual and accelerated-test matchdays are untouched).

| Rule | Trigger | Reason |
| --- | --- | --- |
| Postponed | the provider reports `postponed` for a match that had not started (any time, before or after the entry deadline) | `postponed` |
| Moved to another day | a match that had not started has its kickoff moved to a later **calendar day** (Europe/London), **before or after the entry deadline** | `rescheduled` |
| Abandoned and replayed | the same move, from an `abandoned` fixture: a replay date is the confirmation that the match must be replayed | `abandoned` |
| Unresolved interruption | a `suspended` or `abandoned` fixture of a matchday that is not completed is still unresolved 14 days after its kickoff | `expired` |
| Owner decision | `select public.void_pick8_fixture('<fixture uuid>')` (service role) | `manual` |

Not decided:

* a kickoff delay within the same London day (the same scheduled match, e.g. 15:00 to 17:30);
* a move earlier;
* a started or finished match (`in_play`, `paused`, `finished`) is never voided by a kickoff change or a `postponed` blip;
* plain `cancelled`: it is void while the provider says so, but not decided, because Who You Got also served SUSPENDED and
  ABANDONED as `cancelled` and a provider correction (`cancelled` -> `finished`) must still re-score.

The entry deadline plays no part in the decision. Players who have already picked the fixture lose that pick (it is void, zero
points) and may re-pick another fixture until the deadline, as for any postponed fixture.

Why a calendar day rather than an hour threshold: it is explainable to players ("same day or a different day"), needs no
magic number, and a delay long enough to cross midnight is a postponement in all but name. The provider gives no field that
says "new date" versus "delay", so the stored kickoff is compared with the incoming one.

## Suspended and abandoned matches

Who You Got keeps `status: "cancelled"` for SUSPENDED/ABANDONED (old Pick8 versions keep working) and adds the optional
`providerStatus` field. Pick8 stores a `cancelled` fixture with `providerStatus` SUSPENDED/ABANDONED as `suspended` /
`abandoned`: **held, not void and not terminal**. The matchday waits, for at most 14 days.

* resumes (`in_play`, `finished`, `AWARDED`) with the same kickoff: scored normally, never voided;
* moved to a later day (a replay is scheduled) or reported postponed: void permanently **at once** (`abandoned` /
  `rescheduled` / `postponed`). A replay date is what Pick8 treats as a confirmed abandonment that requires a replay;
* abandoned or suspended with nothing further from the provider: held until **14 days after the fixture's kickoff**, then void
  (`expired`), because the result may still stand (an abandoned match can be awarded) and the provider's own status does not
  say. 14 days matches Who You Got's late-correction window, after which it no longer re-reads the fixture.

### How the 14 day rule runs (no new cron)

`discover_pick8_due_work` is called by all three existing jobs (`sync-fixtures`, `sync-results`, `reconcile-results`). It now also
returns `expiredInterruptedFixtureCount`, a count over local rows only. When it is non-zero, `discover()` in
`utils/pick8-cron-automation.ts` calls `settle_expired_pick8_interrupted_fixtures(now)` once and discovers again. The settlement
`UPDATE`s the fixtures through the normal triggers: the fixture is stamped void, and `fixtures_invalidate_pick8_sync` flags the
matchday for fixture application and scoring, so the second discovery selects it and the same run scores it. Nothing depends on
the provider: it works after Who You Got has stopped re-reading the fixture and when the provider cadence has parked the matchday
days ahead. The daily Vercel `reconcile-results` and `sync-fixtures` jobs guarantee it runs within 24 hours even if the external
5-minute scheduler is not running. A normal run makes no extra request. The settlement is idempotent (voided fixtures are never
candidates), skips completed matchdays (their scores and standings do not move) and manual/accelerated-test matchdays, and
only acts on `suspended`/`abandoned` rows, never on `timed`, `postponed`, `cancelled` or started ones.

If a suspended or abandoned match is voided by the 14 day rule and the provider then resumes or finishes it, the void stands.

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
| Existing data | nothing is backfilled; a fixture already `suspended`/`abandoned` becomes a candidate for the 14 day rule at once if its kickoff is older (it cannot exist before the Who You Got change is enabled).  A fixture that is `postponed` today becomes void the next time its row changes (including its reschedule) |

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

The migration adds `fixtures.voided_at`/`void_reason`, the void trigger, `void_pick8_fixture`, `settle_expired_pick8_interrupted_fixtures`,
two small helper functions and a partial index. `create or replace` re-creates `score_pick8_matchday` and `discover_pick8_due_work` from their latest repo definitions, with
only the void changes; `fixtures_status_check` is dropped and re-added with two more values (a metadata change on a few hundred rows).

## Owner runbook

* **Resolve a suspended/abandoned fixture before the 14 days are up:** `select public.void_pick8_fixture('<fixture id>');` (service
  role, idempotent, final). The next scoring run completes the matchday. Find candidates with
  `select m.matchday_number, f.id, f.status, f.kickoff_at from fixtures f join matchdays m on m.id=f.matchday_id where f.status in ('suspended','abandoned');`
* **A void was wrong:** there is no inverse by design. Disable `fixtures_decide_permanent_void`, clear the two columns for that row,
  re-enable the trigger, and let scoring run, in one reviewed SQL session.
* **Players asking why a fixture is void:** `void_reason` says why; `/rules` states the policy.

## Decisions taken, and what remains

Taken: a move to another calendar day voids even before the entry deadline; unresolved suspended/abandoned fixtures void after 14
days; a replay date voids an abandoned match at once.

Remaining risks and open points:

1. **Provisional dates.** A pre-deadline move to a later calendar day voids the fixture permanently, including an ordinary
   television re-selection (Saturday to Sunday) that the provider publishes after Pick8 first synced the matchday. Pick8 syncs the next
   three matchdays daily, so this is possible but rare; it is exactly the stated policy. If it happens to a fixture that should
   count, the only repair is the reviewed SQL session in the runbook.
2. **`POSTPONED` is trusted at once.** A provider flapping POSTPONED then back to the same day would void a match that is played.
3. **A plain ABANDONED with no replay date** waits the full 14 days (the result may stand); use `void_pick8_fixture` to settle it sooner.
4. **The 14 days run from the stored kickoff**, not from when Pick8 first saw the interruption.
5. **Existing in-flight cases** (matchdays already reopened by an earlier reschedule) are left alone; `void_pick8_fixture` per fixture.
6. A fixture left `timed` long after kickoff by a provider that never updates it is not an interruption and is not expired.

## Verifying

```bash
npm run check
# one-off, outside the repo: npm i embedded-postgres@17.6.0-beta.15 pg
PICK8_PG_TEST_DEPENDENCIES=/path/to/deps node --test tests/pick8-permanent-void-postgres.mjs tests/pick8-postponed-fixtures-postgres.mjs tests/pick8-scoring-postgres.mjs
```
