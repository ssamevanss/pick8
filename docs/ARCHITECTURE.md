# Pick8 architecture

```
Players ──► Vercel (Next.js 16)  ──► Supabase "Pick8" project (Auth + Postgres, RLS)
                │   ▲                      ▲
 admins ────────┘   │ Bearer CRON_SECRET   │ service role (server only)
                    │                      │
  Vercel cron ──────┤  sync-fixtures 02:15 UTC, reconcile-results 05:30 UTC
  external timer ───┘  sync-results ≤ every 5 min   (cron-job.org per docs; not in repo)
                │
                ▼  GET /api/shared-football/fixtures?season=&matchday=  (Bearer WHO_YOU_GOT_API_KEY)
        Who You Got (separate app, separate Supabase project) ──► football-data.org
```

## Components
- **Web app** — App Router. Live pages: `/dashboard` (home), `/my-picks`, `/tables`, `/rules`, `/settings`,
  `/admin`, auth pages. `proxy.ts` gates the prefixes in `utils/supabase/middleware-auth.ts`.
- **Database** — own Supabase project. Core tables: `profiles`, `seasons`, `competitions` (matchday ranges),
  `matchdays` (state, lock time, sync/scoring revisions, fingerprints), `fixtures`, `entries`,
  `entry_selections`. Scoring (`score_pick8_matchday`), due-work discovery (`discover_pick8_due_work`) and
  invalidation triggers are SQL functions, executable only by `service_role`.
- **Automation** (`utils/pick8-cron-automation.ts`): discovery → WYG fetch → fingerprint compare →
  apply fixtures → score → competition refresh. Durable pending flags/revisions make every step retryable.
- **Auth** — Supabase Auth (email+password), invite code `PICK8_SIGNUP_CODE`, password reset via
  `/auth/callback`. Dependency failures render a 503 page rather than logging users out.

## Pick8 ↔ Who You Got
- WYG owns provider ingestion (football-data.org) into `external_fixtures`; Pick8 never talks to the provider.
- Pick8's only coupling is the HTTP contract in `.claude/rules/who-you-got-integration.md`. WYG endpoint:
  `Football_Predictor/football-predictor/app/api/shared-football/fixtures/route.ts` (`PICK8_SHARED_API_KEY` there ⇔
  `WHO_YOU_GOT_API_KEY` here). Pick8 validates strictly and fails closed.
- **Blast radius:** a WYG outage/stale cache ⇒ Pick8 results stop updating (scores stay as last applied; entries and
  locks keep working from Pick8's own data). A WYG contract change ⇒ Pick8 rejects the payload (no corruption) but
  stops syncing. There is no automated cross-repo contract test or freshness alert today (see review).

## Automation state model (short)
`matchdays.sync_pending / scoring_pending / sync_revision / scoring_revision / scored_revision /
applied_fixture_fingerprint / next_provider_check_at / last_upstream_check_at`. Inputs that change a
matchday bump revisions; scoring clears `scoring_pending` only if the revision it read is still current;
the content fingerprint lets unchanged payloads skip application and scoring (≈6 DB requests per clean run).
Details: `result-sync-due-state-redesign.md`, `transactional-scoring-verification.md`.

## Time
All instants are UTC `timestamptz`; display uses `Australia/Melbourne` (`PICK8_TIME_ZONE`). Compare instants,
never formatted strings.

## Legacy
About half of `app/`, `utils/` and `components/` by line count (~20k of ~37k; estimate, some helpers are borderline) is inherited WYG code that targets tables Pick8 doesn't have
(list in AGENTS.md). It is dead for the product but still routable.
