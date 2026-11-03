# Postponed, rescheduled and interrupted fixtures

> **Superseded by [permanent-void-settlement.md](permanent-void-settlement.md)** (the policy below was decided and implemented;
> Part 4 is now historical). Findings A-D and the five questions describe the behaviour *before* that change.

Status: investigation of 2026-10-31. Findings marked **verified** were reproduced against the real migrations
(`tests/pick8-postponed-fixtures-postgres.mjs`); the rest come from reading the code.
Part 4 lists the decisions that need a product owner. Nothing in Part 4 is implemented.

## 1. What happens today

Provider status travels `football-data.org → WYG external_fixtures → WYG /api/shared-football/fixtures → Pick8 fixtures`.

| Provider status | WYG shared API | Pick8 lifecycle | Effect |
| --- | --- | --- | --- |
| `SCHEDULED`, `TIMED` | `scheduled`, `timed` | upcoming / locked | normal |
| `IN_PLAY`, `PAUSED`, `LIVE` | `in_play`, `paused` | live | normal |
| `FINISHED`, `AWARDED` | `finished` | finished | scored |
| `POSTPONED` | `postponed` | void | terminal immediately |
| `CANCELLED` | `cancelled` | void | terminal immediately |
| `SUSPENDED`, `ABANDONED` | **`cancelled`** | void | terminal immediately; indistinguishable from a cancellation |

`score_pick8_matchday` treats `finished`, `postponed` and `cancelled` as terminal. When every fixture is terminal the
matchday is final: void picks score 0 and are excluded from the entry total, finished fixtures' goals alone make the
Total Goals target, entries get `calculated_score`, and the matchday becomes `completed`.

### The five questions

1. **Are postponed matches prematurely settled or voided?** They are voided at once, by design (AGENTS.md and the rules page:
   postponed/cancelled fixtures are void). The matchday completes as soon as the other fixtures finish.
   One guard exists: if a void fixture still has a *future* kickoff, scoring refuses to complete the matchday
   ("cannot be completed before every configured kickoff", **verified**), so a match postponed on the day waits until
   its original slot has passed. `SUSPENDED`/`ABANDONED` get the same treatment, which is the weak point: a match
   halted mid-game normally resumes within a day, but Pick8 cannot tell it from a cancellation.
2. **What happens when a match gets a new kickoff?** WYG's fixture refresh updates `kickoff_at` and `status` together
   once the new date is within its 60-day window. Pick8 applies both on its next sync of that matchday (a completed
   matchday is re-checked every 24 h, `nextProviderCheckAt`). The fixture returns to `timed`, so it is no longer void.
3. **Can a completed matchday reopen?** Yes (**verified**). The fixture is no longer terminal, so the next scoring run
   finds the matchday not final-ready: `status` goes back to `scoring` and every entry's `calculated_score` and
   `score_calculated_at` are set to `null`. When the rescheduled match is played the matchday completes again.
   The schedule cadence is also 5 minutes while a matchday is `scoring` (`nextProviderCheckAt`), so a match rescheduled
   weeks ahead keeps that matchday on the fast poll until it is played.
4. **Do points, standings and Total Goals stay correct?** Per-fixture points always match the fixture state. Standings
   do not stay stable: `pick8-standings` only counts entries with a `calculated_score`, so the whole matchday disappears
   from every player's total and `played` count while the rescheduled match is pending, and competition ranges
   (matchdays 1–5, …) can change leader twice. Total Goals changes meaning: it is judged on N−1 matches when the matchday
   first completes and on N matches after the replay, so the bonus can move to different players weeks later.
5. **Can anyone gain an advantage by editing after the lock?** Normally no: the whole entry locks at the earliest kickoff
   in the database, and the gate is `min(fixtures.kickoff_at)`. It had one hole, now fixed in this PR (below).

### The hole (fixed here, **verified**)

The write gates (`can_submit_pick8_matchday`, `save_pick8_entry`, `replace_submitted_pick8_selections`) took the
deadline live from `min(kickoff_at)`. If the *earliest* fixture's kickoff moved later after the deadline had passed —
a late reschedule, a delayed kickoff, a replay date for an abandoned match — while another fixture was still ahead,
the minimum jumped forward and the matchday accepted edits again. Everyone's pick on the first fixture had already
been revealed at its original kickoff (`isPick8SelectionVisible`), so the reopened window let players copy those picks.

`20261101000000_pick8_deadline_cannot_extend_after_lock.sql` stores the deadline: once `matchdays.locks_at` has passed
for a provider matchday it can only move earlier, and the gates read it through `pick8_entry_deadline()`. Before the
deadline passes nothing changes: a fixture postponed ahead of its kickoff still extends the window to the next kickoff.
Manual and accelerated-test matchdays are unaffected.

## 2. Findings that are not fixed here

| # | Finding | Why not fixed |
| --- | --- | --- |
| A | Reschedule reopens a completed matchday and blanks its scores (Q3, Q4) | scoring policy; Part 4 |
| B | `SUSPENDED`/`ABANDONED` collapse into `cancelled` on the WYG contract | contract is frozen; needs WYG change |
| C | `deriveMatchdayStatus` (TS) marks the matchday `completed` before the SQL guard has agreed. With a void fixture still in the future the matchday reads `completed` with no scores until the slot passes | small; fix together with A so lifecycle comes from one place |
| D | 5-minute polling while one far-future fixture keeps a matchday in `scoring` | resolved by the policy in Part 4 |

## 3. Cross-app notes

- WYG's own game maps `CANCELLED`/`SUSPENDED`/`ABANDONED` to its local `postponed` (terminal, "for admin review")
  and rechecks `SUSPENDED`/`ABANDONED` every 6 h for 14 days (PR #17). Pick8 benefits from that recheck but has already
  completed the matchday by then. Nothing in WYG needs to change for this PR.
- `POSTPONED` is deliberately not polled by WYG's result sync (it would flip a rescheduled match to `TIMED` with its old
  kickoff); WYG's fixture refresh owns the reschedule. Keep that.

## 4. Decisions needed, with a recommendation

The rule today is "void fixtures score 0 and the matchday completes when everything is terminal; provider corrections
re-score". Whether a *reschedule* is a correction is not stated anywhere.

| Option | Behaviour | Cost |
| --- | --- | --- |
| A. Keep (reopen) | Replayed match counts; matchday re-opens, scores vanish meanwhile, Total Goals changes | none, but standings flicker for weeks |
| **B. Void is final once completed** | A fixture void at completion stays void even if rescheduled; the new date is shown, nothing re-scores | small: persist "completed with void fixtures"; skip the reopen path |
| C. Hold completion | Postponed matches keep the matchday open until played or N days pass | matchday results delayed, possibly for months |
| D. Move the fixture | Replayed match scores in the matchday it is played in | a new product feature |

**Recommendation: B, plus treat `SUSPENDED`/`ABANDONED` as pending for 14 days.**

- B keeps published results and standings stable, never changes Total Goals retroactively, and matches how the game is
  described to players (void = no points, no goals). Players locked in before the postponement, so no one gains anything.
- A short hold is right only for matches that really resume. Using WYG's existing 14-day recheck window means a halted
  match settles normally if it resumes and is voided if not. This needs an additive optional field on the WYG response
  (for example `providerStatus`), because Pick8 cannot distinguish them today. Pick8 must ignore unknown fields and
  WYG must keep the existing `status` values.

This is the same two-phase change WYG's `docs/RESULT_SYNC_RELIABILITY_PLAN_2026-10.md` already proposes as step 4
(Pick8 accepts a non-void, non-terminal `suspended` first, then WYG emits it) and ranks as risk 3. WYG's rechecks of
suspended/abandoned matches (#17) and of settled results up to 14 days after kickoff (the late-correction sweep) are
what let Pick8 follow either kind of change; Pick8 itself already re-reads completed matchdays every 24 h.

Implementation sketch for B (needs sign-off first): a `completed_with_void` marker written when scoring completes a
matchday; `score_pick8_matchday` keeps `final_ready` true while the marker is set and only the void fixtures' later
changes are ignored; `nextProviderCheckAt` already drops to 24 h for completed matchdays. Tests: extend
`tests/pick8-postponed-fixtures-postgres.mjs` — the "CURRENT BEHAVIOUR" test flips to assert scores survive.

## 5. Verifying

```bash
# one-off, outside the repo: npm i embedded-postgres@17.6.0-beta.15 pg
PICK8_PG_TEST_DEPENDENCIES=/path/to/deps node --test tests/pick8-postponed-fixtures-postgres.mjs tests/pick8-scoring-postgres.mjs
```

Applying the migration: it re-creates three functions from their latest repo definitions. Compare them with production
(`pg_get_functiondef`) first, since the repo notes some deployed objects are absent from migration history.
