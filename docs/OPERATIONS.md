# Football Predictor App - Operations Guide

## Multi-League Migration (2026-07-31)

Before deploying the multi-league application code:

1. Back up the database.
2. Run `docs/2026-07-31-leagues.sql` in Supabase SQL Editor.
3. Run `docs/2026-07-31-performance-indexes.sql` in Supabase SQL Editor.
4. Run `docs/2026-08-01-multi-league-hardening.sql` in Supabase SQL Editor.
5. Verify the `who-you-got-default` league exists.
6. Verify all existing seasons have its `league_id`.
7. Verify all approved profiles have active default-league membership.
8. Verify `seasons_one_active_per_league_unique` exists.
9. Test one platform admin and one player before production rollout.

Verify the active-season indexes after applying the migration:

```sql
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'seasons'
  and indexdef ilike '%active%';
```

Expected: `seasons_one_active_per_league_unique` is scoped by `league_id`.
Neither `seasons_one_active_idx` nor `seasons_one_active_unique` should remain
when its definition was the recognized global active-season unique index. The
migration intentionally logs and preserves an unknown definition rather than
dropping it blindly. Confirm every active season has a `league_id`, then create
a second league and verify its active season and 38 gameweeks are created.

The migration explicitly grants authenticated read access to the three league
tables, service-role CRUD access, and authenticated execution of the create and
join RPCs, then asks PostgREST to reload its schema cache. RLS remains the
authorization boundary: authenticated users only see active leagues through
their memberships, while invite rows remain league-admin-only.

UX smoke test after migration:

1. Open `/leagues` and verify every active membership and member count.
2. Create each supported competition type with distinct league and current
   season names. Confirm settings immediately show the submitted season name,
   configured competition, 38 gameweeks, and shareable invite.
3. Join through `/leagues/join?code=<CODE>` and confirm redirect to Dashboard.
4. Open a different league and verify the HTTP-only selection cookie changes.
5. Try a guessed league id and a stale cookie; both must return to League Home.
6. Confirm a player sees read-only league details and no invite controls.
7. Confirm a league admin still cannot access platform `/admin` controls.
8. Set and unset a default league, sign out/in, and verify a valid default opens
   Dashboard at `/dashboard` while no default opens `/leagues`; the browser must
   not remain at `/leagues/launch`.
9. Open League Settings as a player, league admin, and platform admin. Confirm
   all see the active member count/list, only the two admin scopes see invites,
   and a league with no active invite offers a working Create invite action.
10. Disable then re-enable a test user. Confirm the profile returns to
    `approved`, existing active league memberships remain intact, login works,
    and the user is again eligible for approved-user reminders and future
    picker rotations.

`/admin` is platform-wide. It is restricted to approved profiles with
`profiles.role = 'admin'`; `league_memberships.role = 'league_admin'` only
controls that league's Settings invite/member/gameweek schedule and safe Double
Gameweek management. It must not grant platform Admin access. Platform Admin's
top-level views are Overview, Users, Leagues, Seasons, and Maintenance.
Overview, Users, and Leagues are global. Seasons stays global until a league is
selected for lifecycle/provider work. Maintenance explicitly labels global
tools versus the selected league's active-season tools.

The Users view always starts from the global profile list. Search and
status/platform-role/league-membership filters only narrow what is displayed;
they never scope or change approval authority. Approve/reject remain
`pending`-only, disable remains `approved`-only, and re-enable remains
`disabled`-only.

The Admin entry point is intentionally absent from the primary header and
bottom navigation. Approved platform admins use Settings -> Platform Admin.
League admins do not see that utility card.

Disabling a profile changes only `profiles.status`; it does not remove or alter
any `league_memberships` row. Re-enabling is strictly `disabled -> approved`, so
the user can sign in again and any existing active memberships remain active.
The join RPC also requires an approved profile. If a membership was separately
marked `removed` or `left`, re-enabling the profile does not restore it; the
user must join again by invite. The initial default-league backfill only adds
profiles that were approved when the migration ran, so an older user with no
backfilled membership must likewise rejoin rather than being added
automatically.

Auth redirect regression checks:

1. Sign out, open `/leagues`, sign in, and confirm return to `/leagues`.
2. Sign out, open `/leagues/join?code=TEST1234`, sign in, and confirm the join
   page still contains `TEST1234`.
3. With no default league, open `/` and confirm launch ends at `/leagues`.
4. With a valid default league, open `/` and confirm launch ends at Dashboard.
5. Remove or invalidate the default membership and confirm launch returns to
   `/leagues` with an explanation rather than looping.
6. Confirm the Leagues nav state is active only on `/leagues`,
   `/leagues/create`, `/leagues/join`, and `/league/settings`, never on the
   internal `/leagues/launch` resolver or a player/admin page.

Protected-route redirects carry a validated relative `next` path through the
login form and validation errors. When no user-facing `next` exists, password
login resolves the same decision as `/leagues/launch` directly: Dashboard only
for a valid default league with an active season, otherwise League Hub. The
launch route itself is uncached and redirect-only for root/callback flows.

Season lifecycle smoke test:

1. Open League Settings as a league admin and confirm there are no create,
   activate, archive, rollover, provider, import, sync, or maintenance actions.
2. Archive the selected league's season as a platform admin, return to League
   Settings, and confirm it says the league is between seasons and a platform
   admin can create the next season.
3. In Platform Admin -> Seasons, select that league and confirm the create form
   says it is scoped to this league.
4. With an active season, use `Roll over this league` and confirm the action
   archives the current season, creates the next active season in the same
   league, and leaves every other league unchanged.

League Hub deliberately separates its required profile lookup (`status` and
`role`) from the optional `default_league_id` lookup. This matters during a
staged rollout: if the updated league migration has not yet added the launch
preference column, `/leagues` must still render instead of treating the schema
error as an unauthenticated account and looping back to login. A profile-query
permission error is shown as a signed-in configuration error; it is never
converted into an authentication redirect.

The migration is idempotent. Create/join use authenticated security-definer
RPCs so league, membership, invite, season, gameweek creation, invite
validation, membership upsert, and usage updates are atomic. A per-form
creation key makes a retried create request return the original league instead
of creating a duplicate. `create_league_for_current_user` accepts the submitted
initial season name and saves it on that new league's active season. Its
competition/year-generated name remains only a fallback for callers that omit
the optional RPC argument; the web form requires 2–100 trimmed characters.

Create League regression checks:

1. Confirm League name explains that the league persists across seasons and
   rejects fewer than 2 or more than 80 trimmed characters.
2. Confirm Current season name is required, accepts 2–100 trimmed characters,
   and appears unchanged in League Settings after creation.
3. Confirm Base competition offers only Premier League, La Liga, Serie A,
   Bundesliga, and Ligue 1, and configures the new season's provider/gameweeks.
4. Retry one submission with the same creation key and confirm the RPC returns
   the original league rather than creating a second league or season.
5. Confirm a league owner can manage the initial league but still has no future
   season create, activate, archive, or rollover controls; those remain in
   Platform Admin for a selected league.

Current job awareness:

- provider caches remain global, while fixture refresh applies provider data to
  every eligible active season's selected local fixtures
- all six cron routes iterate every eligible active season in an active league;
  archived and between-season leagues are skipped
- reminder and predictions-open recipients are filtered to approved active
  members of the season's league
- fixture import, fixture refresh, standings refresh, and result sync deduplicate
  shared provider requests or provider fixture IDs across matching leagues
- a newly created league immediately has one configured active season and 38
  creator-assigned gameweeks

### Final multi-league cron audit and dry-runs

All examples require `CRON_SECRET`; use an Authorization header in shared logs
so the secret is not embedded in the URL. Dry-runs can call the provider and
consume quota, but must not change application rows or send email.

| Route | Scope and provider reuse | Dry-run |
| --- | --- | --- |
| `/api/cron/import-external-fixtures` | All active, import-enabled football-data season configurations in active leagues; unique competition/provider-season requests populate the global cache once. | `curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/import-external-fixtures?dry_run=1"` |
| `/api/cron/refresh-external-fixtures` | One shared snapshot per unique competition/provider-season request, then season-local updates for every eligible active season. | `curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/refresh-external-fixtures?dry_run=1"` |
| `/api/cron/refresh-standings` | All active football-data season configurations in active leagues; identical competition/provider-season requests are reused against the global cache. | `curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/refresh-standings?dry_run=1"` |
| `/api/cron/sync-external-results` | Candidate fixtures are gathered per active sync-enabled season; provider fixture IDs are globally deduplicated before season-local result/scoring application. | `curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/sync-external-results?dry_run=1"` |
| `/api/cron/send-prediction-reminders` | Every active season in an active league; recipients are approved active league members, stable gameweek/user event keys prevent duplicates, and links select the correct league before opening the page. | `curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/send-prediction-reminders?dry_run=1"` |
| `/api/cron/auto-pick-fixtures` | Every active football-data season in an active league; only assigned approved active league pickers are eligible and all local reads/writes use that season's gameweeks. | `curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/auto-pick-fixtures?dry_run=1"` |

Manual Platform Admin fixture import, fixture refresh, standings refresh,
auto-pick, result sync, and export require an explicit `season_id`. The UI
passes the selected league's active season. Direct calls with no season, an
archived season, or a season in an inactive league are rejected rather than
falling back to a global active season.

#### Targeted cron failure diagnostics

Set `DEBUG_CRON=1` temporarily in the runtime environment to log safe phase
timings, season/league ids, competition/provider configuration, call counts,
skip reasons, and error stacks. Logs never include cron secrets, provider keys,
authorization headers, invite codes, or email addresses. Remove or disable the
flag after diagnosis. Provider calls time out after 15 seconds by default;
`FOOTBALL_DATA_TIMEOUT_MS` may be set from 5000–30000 when diagnosing a slow
provider.

Provider/cache routes accept these optional query parameters:

- `season_id=<uuid>` — one active season only.
- `competition_code=PL` — active configs for one competition.
- `limit_configs=1` — cap configs/seasons attempted in this invocation, up to 10.
- `dry_run=1` — no cache/application writes or email sends.

Run all current configurations locally:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/import-external-fixtures?dry_run=1"
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/refresh-external-fixtures?dry_run=1"
```

Isolate one local season or competition:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/import-external-fixtures?dry_run=1&season_id=<season_id>&limit_configs=1"
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/refresh-external-fixtures?dry_run=1&competition_code=PD&limit_configs=1"
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/refresh-standings?dry_run=1&competition_code=PD&limit_configs=1"
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/auto-pick-fixtures?dry_run=1&season_id=<season_id>"
```

Equivalent production dry-runs:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://whoyougot.ie/api/cron/import-external-fixtures?dry_run=1&limit_configs=1"
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://whoyougot.ie/api/cron/refresh-external-fixtures?dry_run=1&limit_configs=1"
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://whoyougot.ie/api/cron/refresh-standings?dry_run=1&limit_configs=1"
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://whoyougot.ie/api/cron/auto-pick-fixtures?dry_run=1&limit_configs=1"
```

Responses include `route`, `phase`, `eligibleSeasonCount`,
`providerConfigCount`, `apiCallCount`, `elapsedMs`, and per-config/season
results. A partial run returns HTTP 207 with both successes and failures. A
provider 429 stops further calls for that route invocation. Dry-run fixture and
standings samples are capped and omit raw provider payloads.

The shared `seasons.provider_season` value is the provider's internal season id
used to match cached rows. It must not be sent directly as football-data.org's
competition `season=` query parameter, which expects a four-digit start year.
Provider routes now omit internal ids and use the provider's current season;
only an explicitly stored four-digit year is sent as `season=`.

#### League-aware email links

Picker-up-next, predictions-open, and 24-hour reminder emails use absolute URLs
from `NEXT_PUBLIC_SITE_URL` and include league plus season context:

```text
https://whoyougot.ie/leagues/select?league=<league_id>&season=<season_id>&next=%2Fpredictions%3Fgameweek%3D<gameweek_id>
https://whoyougot.ie/leagues/select?league=<league_id>&season=<season_id>&next=%2Fpick-fixtures%3Fgameweek%3D<gameweek_id>
```

The selector revalidates current membership and season ownership before setting
`selected_league_id`. Removed/disabled members return safely to League Hub. If
the linked season has since been archived, the selector opens that league's
archived leaderboard instead of silently opening a newer active season. Weekly
result/highlight email delivery is not currently implemented; the weekly
preference is stored for future use only.

### Final bad-state checks

- A league with no active season is a supported between-season state. Player
  routes render that state; playable crons and maintenance writes skip it.
- Two active seasons in one league are prevented by
  `seasons_one_active_per_league_unique`.
- A season without `league_id` is rejected by the final hardening migration.
  Audit/fix legacy nulls before applying it.
- An active season with no gameweeks is safe but not playable; health checks
  flag it and workers report no candidates.
- An unassigned gameweek is visible as an incomplete setup state. Auto-pick and
  picker email skip it.
- A picker outside the league, or a disabled/rejected picker with a retained
  membership row, is rejected by server actions and the database trigger.
- Fixture picking and prediction submission derive the season from the actual
  gameweek/fixture before writing and require the selected league's active
  season.
- Joker writes must use the fixture's actual season; the final hardening
  trigger rejects a mismatched `season_id`.
- Archived/inactive-league seasons are excluded from fixture refresh, result
  sync, reminders, standings, import application, and auto-pick.
- Invites for inactive leagues cannot be joined. Existing invite rows may be
  retained for audit/history.
- Disabled/rejected users can retain membership history, but application and
  SQL membership helpers require `profiles.status = 'approved'`; they cannot
  launch, administer, pick, receive reminders/social notifications, or read
  league-scoped social rows while disabled.
- A stale default league/cookie is revalidated and falls back to League Hub.

### Final multi-league smoke test

Use four accounts: an approved platform admin, a league owner/admin, a normal
player, and a user that can be disabled/re-enabled. Use two active leagues and
at least one archived season.

1. Create a league with distinct league/current-season names. Confirm one owner
   membership, one invite, one active season, and 38 gameweeks in that league.
2. Join the invite as the player; verify no membership appears in the other
   league. Switch leagues repeatedly and inspect the selected league cookie.
3. Set a default league, sign out/in, and verify launch. Remove the membership
   or archive the league and confirm fallback to League Hub.
4. Submit predictions in League A. Forge a League B fixture ID in the form and
   confirm no prediction/Joker row is written. Before kickoff, another League A
   member sees only their own predictions; after lock they can see league peers.
5. Confirm Dashboard activity, highlights, comments/reactions, inbox links, and
   leaderboard totals do not include League B or an archived season.
6. Generate the picker rotation and confirm every picker is an approved active
   member of that league. Forge another league's gameweek/picker IDs and confirm
   rejection. Confirm League A admins cannot edit League B.
7. Toggle Double Gameweek before predictions and confirm only that gameweek is
   changed and Joker is unavailable there. Confirm the same action is rejected
   after prediction, lock, kickoff, or completion.
8. Run all six dry-run commands above with two leagues sharing a competition
   and with different competitions. Confirm season counts, unique provider-call
   counts, no writes/emails, and no archived/between-season candidates.
9. Archive one season. Confirm its leaderboard remains available only through
   that league's history, its activity is absent from the active Dashboard, and
   all normal writes/workers reject it.
10. Create/roll over the next season as platform admin for the selected league.
    Confirm the other league is unchanged and only one active season remains.
11. Verify `/admin` as each role. Only the approved platform admin succeeds;
    league admins use League Settings and cannot invoke Platform Admin actions.
12. Disable the test user while membership and picker history remain. Confirm
    launch, prediction/picker actions, reminders, social notifications, and
    league-admin checks reject/skip them. Re-enable and verify access returns
    only for still-active memberships.

### Request timing diagnostics

Set `DEBUG_TIMINGS=1` only while profiling a trusted environment. Server logs
then report middleware session refresh, league selection auth/membership/total,
request auth/profile, selected league, active season, picker eligibility,
header notifications, App layout, League Hub, League Settings, Dashboard,
Predictions, Leaderboard, Settings, and per-tab Admin timings. Entries
contain route/user/league identifiers where useful, but never cookies, tokens,
invite codes, or secrets. Leave the variable unset in normal operation.
Verbose social-notification lifecycle messages are likewise silent unless
`DEBUG_NOTIFICATIONS=1`; delivery failures remain logged as errors.

### Multi-league performance audit notes

- Player-facing reads use the authenticated Supabase client and remain subject
  to RLS. League Settings uses separate membership/profile reads rather than a
  nested relationship, but does not use the service role for display data.
- `is_active_league_member`, `is_league_admin`, and `is_platform_admin` are
  stable security-definer existence helpers. Their membership/profile lookups
  use primary keys or the league membership indexes, and avoid recursive RLS.
- Apply `docs/2026-08-01-multi-league-hardening.sql`. It makes `season.league_id`
  mandatory, makes membership/admin helpers require an approved profile and
  active league, validates picker and Joker season relationships, and replaces
  the broad approved-user social read policies with season/league membership
  policies. App query filters remain defence in depth, not the only boundary.
- Legacy gameplay policies may have been created in Supabase rather than this
  repository. Inspect the deployed boundary before rollout:

  ```sql
  select schemaname, tablename, policyname, permissive, cmd, qual, with_check
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'seasons', 'gameweeks', 'fixtures', 'predictions', 'joker_usage',
      'leaderboard_entries', 'notifications', 'prediction_reactions',
      'notification_reactions', 'notification_comments',
      'notification_comment_reactions'
    )
  order by tablename, policyname;
  ```

  Confirm gameplay policies follow the season -> league membership relationship
  and prediction reads preserve pre-kickoff privacy. Any deployed policy that
  only checks `profiles.status = 'approved'` is not sufficient.
- Result-sync cron now gathers candidate fixtures for all active seasons,
  deduplicates provider fixture ids globally, fetches each provider id once per
  run, and reuses the snapshot while applying/scoring each league's local rows.
- Fixture import and standings refresh operate on the shared global provider
  cache and now deduplicate active leagues into unique
  provider/competition/season configurations before calling the provider.
  External fixture refresh builds one provider snapshot for every unique
  competition/provider-season request, then safely applies it to each eligible
  season's own selected fixtures.

Before public rollout, apply the migration, populate the shared external
fixture cache for each offered competition, and complete the remaining
legacy gameplay RLS audit described in the architecture document.

## Running locally

From the project root:

```bash
npm install
npm run lint
npm run build
npm run dev
```

Local app usually runs at:

```text
http://localhost:3000
```

Required `.env.local` values:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
NEXT_PUBLIC_SITE_URL=https://whoyougot.ie
SUPABASE_SECRET_KEY=...
LEAGUE_SIGNUP_CODE=...
```

Never expose `SUPABASE_SECRET_KEY` in client-side code.

## Auth and password reset

Login and signup preserve safe form values after validation errors. Passwords
are never echoed back into the page. Password reset uses Supabase Auth emails,
not Resend.

Required setup:

1. Set `NEXT_PUBLIC_SITE_URL` to the canonical app URL, for example
   `https://whoyougot.ie`.
2. In Supabase Dashboard -> Authentication -> URL Configuration, set the Site
   URL to the same production URL.
3. Add allowed redirect URLs for:
   - `https://whoyougot.ie/auth/callback`
   - the current Vercel preview URL if testing previews
   - `http://localhost:3000/auth/callback` for local development
4. In Supabase Dashboard -> Authentication -> Email Templates, keep the reset
   password template using Supabase's confirmation URL. The app callback will
   exchange the code and send users to `/reset-password`.

The forgot-password page intentionally returns the same success message whether
or not an email exists, to avoid account enumeration.

Required for football-data.org fixture imports:

```env
FOOTBALL_DATA_API_KEY=...
```

Never expose `FOOTBALL_DATA_API_KEY` client-side. The provider is only called
from server-only admin import code.

Required for scheduled email notifications:

```env
RESEND_API_KEY=...
REMINDER_EMAIL_FROM="Football Predictor <reminders@example.com>"
BUG_REPORT_EMAIL_TO="Sam <sam@example.com>"
CRON_SECRET=...
```

Never expose `RESEND_API_KEY` client-side. `BUG_REPORT_EMAIL_TO` is read only
by the server action that notifies the app owner after a bug report is stored.

Admin -> Maintenance environment checks report only the runtime currently
serving the page. A local development server can show reminder env vars as
missing even when Vercel Production is correctly configured.

## External fixture imports

2.0B uses football-data.org as the first external fixture provider. Provider
data is cached in local `external_competitions` and `external_fixtures` tables.
2.0C lets assigned fixture pickers select from that local cache. The picker UI
must not call football-data.org directly.

Before using imports, run:

```text
docs/2026-07-05-external-fixture-cache.sql
```

Configure the active season in Platform Admin -> Seasons after selecting its league. Choose
`football_data`, select the base competition, and save. The UI fills the
competition name and provider id automatically.

Keep `fixture_import_enabled = false` until dry-run output is reviewed. Keep
`result_sync_enabled = false` until selected-fixture result sync has been
tested for the season. Dry-run result sync remains available while disabled;
real manual and cron sync require `result_sync_enabled = true`.

football-data.org free tier is limited to 10 requests/minute. Import routes
make one provider request per selected competition and return a clear 429 error with
`x_requestcounter_reset` if the provider limit is reached. Avoid repeated manual
imports inside the same minute.

Admin -> Maintenance includes an in-page external fixture import card. Use the
competition dropdown to import the active season base competition or another
enabled football-data.org competition such as La Liga, Serie A, Bundesliga, or
Ligue 1 into the shared cache. Dry-run output stays in the page and shows
provider calls, fetched count, sample fixtures, planned rows, skipped rows, and
errors/warnings.

Fixture import is currently admin/manual only through this card or the
admin-only import API below. Scheduled import is also available through
cron-job.org at `/api/cron/import-external-fixtures`; use it once the active
season provider/competition settings have been checked.

Dry-run locally while logged in as an admin:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"season_id":"<season_id>","competition_code":"PL","dry_run":1}' \
  "http://localhost:3000/api/admin/external-fixtures/import"
```

Browser-based dry-run is also available when already signed in as admin:

```text
http://localhost:3000/api/admin/external-fixtures/import?season_id=<season_id>&competition_code=PL&dry_run=1
```

A real import requires `fixture_import_enabled = true` for the target season.
Enable it from Platform Admin -> Seasons after reviewing dry-run
output:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"season_id":"<season_id>","competition_code":"PL","dry_run":0}' \
  "http://localhost:3000/api/admin/external-fixtures/import"
```

cron-job.org production pattern for importing the active season base
competition:

```text
GET https://<production-domain>/api/cron/import-external-fixtures
Authorization: Bearer <CRON_SECRET>
```

Useful query params:

- `dry_run=1`: fetch provider rows but do not write.
- `include_enabled=1`: import every enabled football-data.org competition in
  `external_competitions`; this costs one provider call per competition.
- `date_from=YYYY-MM-DD&date_to=YYYY-MM-DD`: override the default rolling
  import window.

Recommended PL schedule: daily during the season, or weekly before each PL
round if provider-call budget is tight.

The import writes only `external_fixtures`. It does not create gameplay
fixtures, update results, score predictions, or recalculate leaderboards.

For World Cup knockout fixtures, football-data.org may return
`matchday = null`. Admins can manually assign local grouping values by provider
fixture id:

```sql
update public.external_fixtures
set external_matchday = 7
where provider = 'football_data'
  and external_fixture_id in ('<fixture_id_1>', '<fixture_id_2>');
```

Later imports preserve an existing `external_matchday` when the provider still
returns `null`. If football-data.org later returns a non-null matchday, the
provider value is used.

### Testing cached fixture picking

With the current World Cup test setup:

1. Confirm Platform Admin -> Seasons has `football_data` and `WC` for the selected league.
2. Confirm `external_fixtures` has upcoming `TIMED` or `SCHEDULED` WC rows.
3. Log in as the assigned picker for an unlocked active-season gameweek.
4. Open `/pick-fixtures`.
5. Use the Fixture list section to select the available cached fixtures
   for the selected external matchday group. It defaults to the season base
   competition, but a Browse competition selector appears when more enabled
   cached competitions are available.
6. Save selected cached fixtures.
7. Confirm the expected number of rows were inserted into `fixtures` with:
   - `status = scheduled`
   - `external_provider = football_data`
   - `external_fixture_id` populated
   - `external_competition_code = WC`
8. Confirm the manual fallback remains visible and editable until predictions
   exist.

If a cached fixture is missing, run the admin import dry-run/real import flow
again. If a fixture was already selected in another active-season gameweek, the
picker excludes it from selectable cached fixtures.

Admins can also add cached external fixtures from Platform Admin -> Maintenance. The admin
card reads the same local `external_fixtures` cache, does not call
football-data.org from the browser, copies the same provenance fields into
`fixtures`, and rejects duplicates that are already selected in another active
season gameweek. Manual fixture entry remains available underneath for
overrides.

Special fixtures from another competition:

- Use the Browse competition selector in `/pick-fixtures` or Platform Admin -> Maintenance.
- Alternate competitions must already exist in `external_competitions` and have
  cached rows in `external_fixtures`.
- The UI labels this as a special fixture override when the selected
  competition is not the season base competition.
- If a selected cached or manual fixture is outside the usual gameweek timing
  window, the app shows a warning and requires an "add it anyway" confirmation.
- For league-mode seasons, the timing window comes from provider base-league
  groups: the current base matchday's first kickoff through the next base
  matchday's first kickoff minus 24 hours. This keeps Friday/Monday league
  fixtures valid while preventing special fixtures from crossing into the next
  base-league prediction cycle.
- Tournament/cup-style seasons do not apply the league cutoff; close-together
  knockout fixtures are valid and expected.
- The warning is not a hard block; it is there to catch accidental wrong-week
  selections while still allowing cup ties and moved fixtures.

Useful cache checks before Premier League picking:

```sql
select
  external_competition_code,
  count(*) as fixtures,
  min(kickoff_at) as first_kickoff,
  max(kickoff_at) as last_kickoff
from public.external_fixtures
group by external_competition_code
order by external_competition_code;
```

```sql
select
  id,
  external_competition_code,
  home_team,
  away_team,
  kickoff_at,
  external_matchday,
  status
from public.external_fixtures
where home_team ilike '%Arsenal%'
   or away_team ilike '%Arsenal%'
   or home_team ilike '%Coventry%'
   or away_team ilike '%Coventry%'
order by kickoff_at;
```

## External result sync

2.0D adds an admin-only manual result sync endpoint for fixtures that were
selected from cached football-data.org rows:

```text
/api/admin/external-fixtures/sync-results
```

The route only checks local gameplay `fixtures` that are linked with
`external_provider = 'football_data'` and belong to the requested season. It
uses football-data.org's batch `ids` endpoint server-side, updates the selected
local fixtures and matching `external_fixtures` cache rows, then runs the
existing scoring, leaderboard recalculation, and post-result activity
notification flow when a fixture becomes completed or a completed score changes.

Dry-run in a browser while signed in as an approved admin:

```text
http://localhost:3000/api/admin/external-fixtures/sync-results?season_id=<season_id>
```

Dry-run one local fixture:

```text
http://localhost:3000/api/admin/external-fixtures/sync-results?season_id=<season_id>&fixture_id=<fixture_id>
```

Run a real sync locally with an admin session cookie:

```bash
curl -X POST \
  -b cookies.txt \
  "http://localhost:3000/api/admin/external-fixtures/sync-results?season_id=<season_id>&dry_run=0"
```

Use `dry_run=1` with POST if you want the POST response shape without writing.
Do not call this route from player-facing pages and do not expose
`FOOTBALL_DATA_API_KEY` client-side.

Inspect selected external fixtures before or after a sync:

```sql
select
  f.id,
  gw.gameweek_number,
  f.home_team,
  f.away_team,
  f.kickoff_at,
  f.status,
  f.home_score,
  f.away_score,
  f.external_fixture_id,
  f.external_competition_code,
  f.external_matchday,
  f.external_status,
  f.external_last_synced_at
from public.fixtures f
join public.gameweeks gw on gw.id = f.gameweek_id
where gw.season_id = '<season_id>'
  and f.external_provider = 'football_data'
order by f.kickoff_at;
```

football-data.org World Cup knockout rows may still have provider
`matchday = null`. Result sync does not update `external_matchday`, so manually
assigned World Cup grouping values are preserved.

Cup/test gameweeks can contain fewer than four fixtures. Fixture-picked activity
uses the current fixture count for the gameweek, so edited two-fixture or
one-fixture matchdays should not leave future notifications saying four
fixtures were picked.

Double Gameweeks require:

```bash
docs/2026-07-06-double-gameweeks.sql
```

Platform admins can toggle Double Gameweek in Platform Admin -> Maintenance. All
prediction points in that gameweek count 2x, Jokers are disabled, and existing
Joker rows for the gameweek are removed so users do not lose a season Joker.
The platform form follows the same active-season, no-prediction, pre-kickoff,
unlocked/unfinalized rule as League Settings; completed-gameweek changes are no
longer offered as an emergency correction path.

League admins use League Settings -> Gameweek pickers. Their action derives the
gameweek's league server-side and requires an active `league_admin` membership
for that actual league (platform admins bypass the membership requirement). It
allows only an active season with no submitted predictions, no locked/completed/
void fixture, and no kickoff at or before the current time. The UI is view-only
for picker assignment. Test both the visible disabled state and a direct forged
form submission; the server action must reject the latter.

### Scheduled external result sync

Fixture refresh and result sync are separate jobs:

- Fixture refresh updates upcoming team names, kickoff times, provider status,
  and round/stage metadata before kickoff.
- Result sync updates final scores after kickoff and triggers scoring,
  leaderboard recalculation, and post-result activity.
- For knockout/cup matches, result sync scores predictions from the
  football-data.org 90-minute `score.regularTime` when available. If the match
  duration is extra time or penalties and `regularTime` is missing, the fixture
  is skipped/admin-reported rather than scoring predictions from the wrong
  extra-time or penalty score.

### Scheduled external fixture refresh

Upcoming fixture refresh uses:

```text
/api/cron/refresh-external-fixtures
```

It requires `CRON_SECRET` and accepts:

```text
Authorization: Bearer <CRON_SECRET>
```

or:

```text
?token=<CRON_SECRET>
```

Dry-run local test:

```bash
curl "http://localhost:3000/api/cron/refresh-external-fixtures?token=$CRON_SECRET&dry_run=1"
```

Real local test:

```bash
curl "http://localhost:3000/api/cron/refresh-external-fixtures?token=$CRON_SECRET"
```

The route considers every season in an active league that has:

```text
base_provider = football_data
fixture_import_enabled = true
```

If no eligible active season is configured, it returns a skipped response and
does not call football-data.org. Refresh keeps provider calls low by fetching
each unique active base competition/provider-season plus any already-selected
linked fixture competitions once, then reusing that snapshot while updating
each season's local linked fixtures safely.

Safe selected-fixture propagation:

- kickoff changes are applied only to non-terminal linked fixtures
- team names are updated when predictions do not exist, or when the local team
  name is a placeholder such as `TBD`, `TBC`, `Winner of`, or `Loser of`
- selected fixture scores are never changed by fixture refresh
- completed/void/postponed selected fixtures are skipped
- manually assigned World Cup `external_matchday` values are preserved when
  football-data.org returns `matchday = null`

Recommended scheduler frequency:

- every 6 or 12 hours during normal league weeks
- every 1 to 3 hours during cup/tournament knockout periods if teams are
  resolving quickly
- keep result sync separate at every 5 to 15 minutes around live match windows

cron-job.org production pattern:

```text
GET https://<production-domain>/api/cron/refresh-external-fixtures
Authorization: Bearer <CRON_SECRET>
```

2.0E adds a protected cron-compatible route:

```text
/api/cron/sync-external-results
```

It requires `CRON_SECRET` and accepts either:

```text
Authorization: Bearer <CRON_SECRET>
```

or, for simple external schedulers:

```text
?token=<CRON_SECRET>
```

Local test:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/sync-external-results"
```

Token query test:

```bash
curl "http://localhost:3000/api/cron/sync-external-results?token=$CRON_SECRET"
```

Dry-run test:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/sync-external-results?dry_run=1"
```

The route performs a real sync by default. `dry_run=1` fetches and reports the
shared provider snapshot without changing fixtures, scoring, activity, or
leaderboards. It only runs when an active season has:

```text
base_provider = football_data
result_sync_enabled = true
```

It self-throttles by querying selected local fixtures first and only calls
football-data.org when linked fixtures are within the sync window:

- from 30 minutes before kickoff
- until 24 hours after kickoff
- completed fixtures are checked only occasionally during that 24-hour window
  for score confirmation

If no selected fixtures need checking, the route returns `api_call_count = 0`
and does not call the provider.

During testing, an external scheduler such as cron-job.org can call the route
every 5 minutes. Vercel Hobby cron is daily only, so it is not suitable for
frequent result polling. Keep the scheduler disabled outside active match
windows unless you specifically want the endpoint's DB-window skip response.

cron-job.org production pattern:

```text
GET https://<production-domain>/api/cron/sync-external-results
Authorization: Bearer <CRON_SECRET>
```

Production scheduler checklist:

1. Confirm `CRON_SECRET` is set in Vercel Production and matches the external
   scheduler secret.
2. Confirm the active season has `base_provider = football_data` and
   `result_sync_enabled = true` only when selected external fixtures are ready
   for automated result checks.
3. Test the scheduler URL with `Authorization: Bearer <CRON_SECRET>` and check
   that idle windows return `api_call_count = 0`.
4. Keep `/api/cron/sync-external-results` separate from
   `/api/cron/send-prediction-reminders`; result sync never sends emails, and
   reminder cron never syncs scores.
5. Review hosting logs and cron-job.org job history after the first live match
   window for provider errors, scoring updates, and duplicate-notification
   warnings.

## Deployment

The app is deployed on Vercel.

Before deploying:

```bash
npm run lint
npm run build
```

After deploying:

- Open production URL
- Log in as admin
- Check Home
- Check Predictions
- Check Leaderboard
- Check Platform Admin -> Seasons
- Check Platform Admin -> Maintenance
- Check hosting/scheduler logs for errors

## Scheduled prediction reminders

cron-job.org calls:

```text
/api/cron/send-prediction-reminders
```

The route requires `CRON_SECRET` with either:

```text
Authorization: Bearer <CRON_SECRET>
```

or `?token=<CRON_SECRET>` for simple scheduler configuration. During testing,
run it every 5 to 15 minutes around prediction deadlines; in normal operation,
hourly or daily is usually enough depending on how many close-to-kickoff
fixtures are expected.

The route is now the scheduled email-notification route. It remains separate
from `/api/cron/sync-external-results` and never syncs scores.

cron-job.org production pattern:

```text
GET https://<production-domain>/api/cron/send-prediction-reminders
Authorization: Bearer <CRON_SECRET>
```

## Pre-PL follow-ups

- Backfill enough completed `external_fixtures` before PL starts so recent form
  has meaningful non-picked match data.
- Extend crest/alias coverage for selectable European leagues if provider crest
  URLs are unavailable or blocked.
- Add smarter fixture auto-pick ranking later; the first implementation is
  intentionally random among eligible base-competition fixtures.

## Auto-pick missed fixture selections

Auto-pick fills missing fixture selections when the assigned picker has not
completed a due gameweek. It uses only the active season base competition and
never calls provider APIs from player-facing pages.

Admin Maintenance includes dry-run and run buttons. The secured cron endpoint
is:

```text
/api/cron/auto-pick-fixtures
```

cron-job.org production pattern:

```text
GET https://<production-domain>/api/cron/auto-pick-fixtures
Authorization: Bearer <CRON_SECRET>
```

Use `dry_run=1` to inspect candidate gameweeks without writing.

Rules:

- only active football-data seasons are considered
- the league must be active and the assigned picker must be an approved active
  member of that league; unassigned or stale picker rows are reported/skipped
- the active season must have a base competition code
- a gameweek is due 12 hours before the first eligible base-competition kickoff
- existing completed/void/postponed selections are never overwritten
- gameweeks with predictions are skipped
- partial safe selections are filled from the same base fixture group where
  possible
- duplicate external fixtures across the active season are avoided
- when auto-pick completes a fixture set, normal Picks activity and
  predictions-open email de-dupe run

Recommended schedule: hourly on cron-job.org during PL weeks, or several times
per day if you want fewer invocations.

## Standings Refresh

Run `docs/2026-07-30-external-team-standings.sql` before enabling standings
display. Standings are cached in `external_team_standings` and read by pages
locally; page render never calls football-data.org.

Prediction and picker cards hide all-zero pre-season tables so users do not see
misleading positions before a league has started. If all cached rows for a
provider season have played/won/drawn/lost/points equal to zero, the form guide
shows "Table available after matches are played" instead.

Provider-linked club cards use trusted cached football-data.org crest URLs from
fixture `raw_payload` when available, with local team asset mappings and short
codes as fallback. Fixture kickoffs shown to players use the viewer's local
timezone so prediction lock times are personally meaningful; stored
`kickoff_at` values remain UTC instants.

Admin Maintenance includes standings dry-run/run controls. The secured cron
endpoint is:

```text
/api/cron/refresh-standings
```

cron-job.org production pattern:

```text
GET https://<production-domain>/api/cron/refresh-standings
Authorization: Bearer <CRON_SECRET>
```

Recommended schedule: daily after result sync windows, plus one manual refresh
after importing a new PL round.

Inspect cached standings:

```sql
select
  external_competition_code,
  provider_season,
  position,
  team_name,
  played,
  points,
  updated_at
from public.external_team_standings
order by external_competition_code, position;
```

Before enabling it, run:

```bash
docs/2026-07-06-email-notifications.sql
docs/2026-07-06-user-email-preferences.sql
```

The email layer sends/logs:

- `picker_up_next`: one email to the assigned picker when a gameweek becomes
  actionable. It is triggered by post-result activity and also checked by cron
  as a fallback.
- `predictions_open`: one email per approved user when the current fixture set
  is saved and complete. When the assigned picker saves fixtures, the picker is
  excluded from the immediate email; they can still receive the 24h reminder if
  their predictions are incomplete. Admin fixture saves can send/recover this
  email even if predictions have already started, but event keys prevent
  duplicates.
- `predictions_24h`: one email per incomplete approved user when at least one
  selected fixture is within 24 hours of kickoff.

Each send is logged in `email_notifications` only after Resend succeeds. Stable
event keys prevent duplicates:

```text
picker_up_next:<gameweek_id>:<user_id>
predictions_open:<gameweek_id>:<user_id>
predictions_24h:<gameweek_id>:<user_id>
```

If fixtures are edited before predictions exist, the in-app fixture-picked
notification is updated. The predictions-open email is not resent
automatically, which avoids repeated fixture-edit spam. Send an explicit manual
note outside the app if a fixture change is important after the first email.

The 24-hour reminder checks actual selected/actionable fixtures. A two-fixture
World Cup gameweek is complete once a user has predictions for those two
fixtures; normal PL gameweeks still normally have four selected fixtures.
Prediction-open and reminder emails mention Double Gameweek when the selected
gameweek is marked as double.

Gmail tab placement is controlled by Gmail and can vary by user. The app keeps
24-hour reminder emails short, branded, and transactional, using the same email
shell as predictions-open while avoiding marketing-heavy copy. Users can move a
reminder to Primary or mark it as important to train Gmail for future league
emails.

Email preferences:

- Users manage email preferences at `/settings`.
- Missing `user_email_preferences` rows are treated as all enabled.
- `predictions_open` respects `predictions_open_enabled`.
- `predictions_24h` respects `prediction_reminders_enabled`.
- `picker_up_next` respects `picker_notifications_enabled`.
- Email footers include a Manage email preferences link.
- Opting out affects email only; dashboard activity and app access are
  unchanged.

Bug reports:

- Run `docs/2026-07-30-bug-reports.sql` before enabling user bug reports.
- Users submit bug reports from `/settings`.
- The server action stores the report in `bug_reports` before attempting email.
- Email notification goes to `BUG_REPORT_EMAIL_TO` using Resend.
- If the database insert succeeds but email fails or `BUG_REPORT_EMAIL_TO` is
  missing, the user sees a softer saved-but-email-failed toast and the report
  remains available in the database.
- Normal users cannot read the shared report table. Approved admins and
  service-role/admin tooling can read/update reports.

Inspect recent reports:

```sql
select
  created_at,
  status,
  user_name,
  user_email,
  page_url,
  left(message, 160) as message_preview
from public.bug_reports
order by created_at desc
limit 20;
```

Social notification inbox:

- Run `docs/2026-07-07-user-notifications.sql` before enabling the header bell
  in production.
- The bell uses `user_notifications` for grouped, user-scoped social activity.
- Rows are grouped by recipient + target/type, so repeated reactions/comments
  update one unread inbox item instead of creating a noisy stream.
- Users can only read and mark their own inbox notifications. Writes are made
  by server actions after approved-user checks.
- The inbox is separate from email notifications and does not send email.
- The bell badge counts unread grouped rows. Opening the dropdown does not mark
  rows read; clicking a notification, using per-item Clear, or using Mark all
  read marks rows read.
- Social inbox test: sign in as User A and comment on a league activity item;
  sign in as User B and confirm the bell badge increments, click the inbox row,
  and confirm it navigates to `/dashboard?activity=...&comments=1` with the
  comments open and the unread count reduced.
- Current direct-actor detection covers prediction owners, comment owners, and
  fixture-picker activity owners. Richer named-player extraction from highlight
  text can be added later if needed.
- If a social action writes the source reaction/comment but no inbox row appears,
  check server logs for `[user-notifications]` errors. The grouped inbox helper
  logs recipient lookup and `user_notifications` insert/update failures without
  exposing secrets.
- Admin Maintenance includes a Social inbox diagnostics card. Use Create test
  notification to insert a grouped `maintenance_test` row for the current admin
  before debugging social actions.
- Useful Vercel log markers:
  - `[user-notifications] activity comment notifications requested`
  - `[user-notifications] prediction reaction notification requested`
  - `[user-notifications] comment reaction notification requested`
  - `[user-notifications] activity reaction notification requested`
  - `[user-notifications] creating`
  - `[user-notifications] notification inserted`
  - `[user-notifications] notification updated`
  - `[user-notifications] notification insert failed`
  - `[user-notifications] skipped missing participant`
  - `[user-notifications] skipped self notification`

Debug recent inbox rows:

```sql
select
  id,
  user_id,
  notification_type,
  grouping_key,
  read_at,
  created_at,
  updated_at,
  metadata
from public.user_notifications
order by updated_at desc
limit 50;
```

Debug unread counts by user:

```sql
select
  p.id,
  p.display_name,
  p.email,
  p.status,
  p.role,
  count(un.id) as total_notifications,
  count(*) filter (where un.read_at is null) as unread_notifications
from public.profiles p
left join public.user_notifications un
  on un.user_id = p.id
group by p.id, p.display_name, p.email, p.status, p.role
order by p.display_name;
```

Expected full PL season volume for 30 players and 38 gameweeks:

- 38 picker-up-next emails
- 1,140 predictions-open emails
- up to 1,140 prediction deadline emails, only for incomplete users
- worst case around 2,318 emails

### Safe testing

Use dry-run mode first. It checks due gameweeks and users but does not send
email or insert `email_notifications` rows:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://your-production-domain/api/cron/send-prediction-reminders?dry_run=1"
```

For local testing:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/send-prediction-reminders?dry_run=1"
```

Only remove `dry_run=1` after confirming the due gameweek, candidate users,
and environment variables in Admin -> Maintenance.

## Admin season setup flow

### Starting a test/trial season

1. Go to Platform Admin -> Seasons and select the league.
2. Create a new season.
3. Choose type:
   - `test` for normal trial
   - `world_cup` for a cup-style trial
4. Choose number of gameweeks.
5. Leave `Auto-assign fixture pickers` checked.
6. Create as draft or active.
7. If draft, activate when ready.
8. Confirm gameweek picker assignments.
9. Manually adjust any picker if needed.

### Starting the real season

1. Archive or delete test seasons.
2. Create real season as `standard`.
3. Create 38 gameweeks.
4. Auto-assign fixture pickers.
5. Review Gameweek 1-38 assignments.
6. Activate real season.
7. Export baseline season backup.

### End of season

1. Ensure all results are entered.
2. Recalculate leaderboard.
3. Confirm final leaderboard.
4. Export final season backup.
5. Go to Platform Admin -> Seasons and select the league.
6. If the league should pause between seasons, use `Archive season`,
   acknowledge the warning, and stop there.
7. Confirm the old season is archived, visible in `Past seasons`, and retained
   read-only. Confirm fixture import and result sync are off.
8. When the next season is ready, create it for the same league; or use
   `Archive and start next season` for an immediate rollover.
9. Confirm the new season is active, clean, and has generated gameweeks.
10. Review gameweek picker assignments.
11. Update the new season provider season if needed.
12. Import/refresh upcoming external fixtures when ready.

Rollover preserves:

- old fixtures, predictions, joker usage, leaderboard entries, activity,
  comments, reactions, and facts
- archived season visibility when `show_in_archive = true`

Rollover resets for the new season:

- selected fixtures
- predictions
- joker usage
- activity/comments/reactions
- scored leaderboard data

Archived seasons are skipped by normal active-season flows: dashboard current
summary, predictions, pick fixtures, reminder emails, predictions-open emails,
picker-up-next emails, result sync cron, and fixture refresh cron.

Manual archive behavior:

- requires an approved `profiles.role = admin` account and a checked
  confirmation
- rejects an already archived season
- sets `status = archived`, `is_active = false`, and `show_in_archive = true`
- records `archived_at`/`archived_by`
- sets `fixture_import_enabled = false` and `result_sync_enabled = false`
- preserves memberships and every historical gameplay/social row
- never deletes or rewrites the shared external fixture cache

After manual archive, `Your leagues` no longer shows that league as playable
when it has no other active season. Its membership appears under the collapsed
`Past seasons` section. `View history` selects the league and opens
`/leaderboard?season=<id>`; Dashboard, Predictions, and Pick Fixtures show a
friendly `This league has no active season` state.

League archive remains deferred. A league with no active season is treated as
between seasons while `leagues.status` and memberships remain unchanged. This
preserves invite/member state for the next season.

Suggested verification SQL:

```sql
select id, name, status, show_in_archive, created_at
from public.seasons
order by created_at desc;

select status, count(*)
from public.seasons
group by status
order by status;

select season_id, count(*) as gameweeks
from public.gameweeks
group by season_id
order by season_id;

select season_id, count(*) as leaderboard_rows
from public.leaderboard_entries
group by season_id
order by season_id;
```

Expected after rollover (per league):

- at most one `active` season for that league
- old season `archived`
- new season has the expected gameweek count
- new season has no copied predictions, fixtures, joker usage, comments, or
  reactions
- picker assignments use only active approved members of the same league

All scheduled workers filter `seasons.status = 'active'`: reminder emails,
auto-pick, fixture import/application, standings refresh, external result sync,
and gameplay notification email discovery. Provider cache refresh remains
global, but its application to local seasons considers only active enabled
season targets.

## Weekly admin flow

For each gameweek:

1. Confirm the correct picker is assigned.
2. Wait for picker to select fixtures.
3. Check fixtures/kickoff times.
4. Players enter predictions.
5. After matches finish, select the league in Platform Admin -> Maintenance and
   enter results for its active season.
6. Confirm leaderboard updates.
7. Confirm activity feed updates.
8. Export season data.

## Scoring and corrections

Scores are calculated when results are saved through Platform Admin ->
Maintenance for the selected league's active season.

If an admin enters the wrong result, correct it in Platform Admin ->
Maintenance and save again.

Expected recalculation:

```text
fixture scores update
prediction points update
exact/result flags update
leaderboard recalculates
activity feed upserts gameweek complete notification
```

Avoid editing fixture results directly in SQL because that bypasses scoring and leaderboard recalculation.

If SQL is used to update scores, run a scoring/recalculation script afterwards or re-save results through the app.

## Backups

The app is small, but season data matters to users. Take exports regularly.

Recommended schedule:

- Before real season starts
- After each gameweek is complete
- Before major schema/code changes
- Before deleting any season
- At season end

Future Admin Maintenance should include a one-click export of:

```text
season
profiles
gameweeks
fixtures
predictions
joker_usage
leaderboard_entries
notifications
```

Suggested filename format:

```text
football-predictor-<season-name>-export-YYYY-MM-DD.json
```

## Common issues and recovery

### No active season

Symptoms:

- Home says no active season
- Predictions empty
- Leaderboard empty

Fix:

- Platform Admin -> Seasons
- Activate the correct season

### Wrong season visible to users

Fix:

- Platform Admin -> Seasons
- Archive incorrect active season
- Activate correct season

### Test season appears in previous leaderboards

Fix:

- Platform Admin -> Seasons
- For that archived test season, turn off `Show in previous seasons`
- Or delete it if safe

### Picker cannot see Pick Fixtures

Check:

- User is approved
- User is assigned as `gameweeks.fixture_picker_id`
- Previous gameweek is complete, unless Gameweek 1
- Current assigned gameweek has no predictions yet if editing existing fixture selection

### Fixtures selected but picker cannot edit

Likely cause:

- Predictions already exist for that gameweek

Fix:

- Admin can override fixtures from Admin -> Fixtures if needed

### Prediction says pending after result was manually entered in SQL

Cause:

- SQL updated fixture result but did not update predictions.

Fix:

- Re-save result through Admin -> Results if possible
- Or run scoring/recalculation script

### Leaderboard looks wrong

Fix:

- Use Admin Maintenance recalculate leaderboard once built
- Until then, use the existing server action path that recalculates after results are saved

### User stuck pending

Fix:

- Admin -> Users
- Approve user

### User cannot log in after being disabled/rejected

Expected behaviour. Admin can re-enable/approve if needed.

## Technical maintenance

### During the season

Avoid major framework upgrades close to prediction deadlines.

Recommended monthly checks:

```bash
npm run lint
npm run build
```

Optional:

```bash
npm outdated
```

Only update dependencies if there is a clear reason, such as security fixes or needed functionality.

### Before changing schema

1. Export season data.
2. Save SQL migration in repo/docs or migrations folder.
3. Run SQL in Supabase.
4. Test locally.
5. Run lint/build.
6. Deploy.
7. Smoke test production.

## Monitoring

### Pick8 fixture and result automation

Vercel invokes three authenticated GET routes. Schedules are UTC:

- `/api/cron/sync-fixtures` at `02:15` daily (approximately 02:15 Dublin in winter and 03:15 in summer). It syncs every open/scoring matchday plus the next three upcoming matchdays.
- `/api/cron/sync-results` every five minutes. It makes no Who You Got request unless a matchday is scoring, has a live/paused fixture, has an unfinished local result near kickoff (30 minutes ahead through four hours behind), or has a finished fixture whose matchday is not completed.
- `/api/cron/reconcile-results` at `05:30` daily. It re-syncs and recalculates matchdays with fixtures from the previous two complete UTC calendar days, plus any matchday still scoring. This is the correction safety net for late provider changes.

Required production environment variables:

```text
CRON_SECRET
WHO_YOU_GOT_API_URL
WHO_YOU_GOT_API_KEY
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SECRET_KEY
```

All three cron endpoints require exactly `Authorization: Bearer <CRON_SECRET>`. They do not accept query-string secrets. A missing header returns 401, an incorrect value returns 403, and a missing server configuration fails closed.

Manual verification (replace placeholders locally; never paste real values into tickets or logs):

```bash
curl -H 'Authorization: Bearer <CRON_SECRET>' \
  https://<deployment>/api/cron/sync-fixtures
curl -H 'Authorization: Bearer <CRON_SECRET>' \
  https://<deployment>/api/cron/sync-results
curl -H 'Authorization: Bearer <CRON_SECRET>' \
  https://<deployment>/api/cron/reconcile-results
```

Responses and structured runtime logs report the route, season/matchday, duration, fixture counts, recalculation state, and isolated failures. They never include either secret. A successful no-op response has `skipped: true` and explains why. One matchday failure does not prevent later matchdays in the invocation from running.

The automation deduplicates matchdays and uses a process-local in-flight guard, so a single invocation cannot process the same matchday twice. This is best-effort only: separate serverless instances can overlap because no distributed database lock was added. The sync/upsert and scoring code is idempotent, but operators should avoid manually triggering a route while its scheduled invocation is running. A durable cross-instance lease can be added later if operational evidence warrants a schema change.

Troubleshooting:

- 401 means the bearer header was omitted; 403 means its value does not match `CRON_SECRET`; 500 before processing commonly means a required server environment variable is absent.
- An individual failure appears in the response `failures` array and in the structured runtime log. Other selected matchdays still run.
- Repeated Who You Got authentication, missing-mapping, or upstream failures should be checked against the Who You Got service configuration and availability. Pick8 never bypasses the shared Who You Got API to contact its football provider directly.
- A normal no-op is not an incident: result polling deliberately skips the remote dependency outside useful fixture windows.

Current lightweight monitoring:

- Hosting runtime logs
- cron-job.org job history
- Supabase dashboard/logs
- Manual smoke tests

Recommended future Admin Maintenance health check:

- Database reachable
- Active season exists
- Approved user count
- Gameweek count
- Gameweeks without pickers
- Fixtures without kickoff
- Completed fixtures missing scores
- Completed fixtures with pending prediction points
- Leaderboard entries count
- Environment variables present

## Data-loss risks

Most likely risks:

- Bad SQL
- Accidental season deletion
- RLS/policy mistake
- Bad deployment
- Missing environment variable
- Supabase/Vercel outage

Mitigations:

- Export before changes
- Use delete restrictions
- Run lint/build before deploy
- Keep docs updated
- Avoid risky updates during live gameweeks
