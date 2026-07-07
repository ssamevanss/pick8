# Football Predictor App - Operations Guide

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
CRON_SECRET=...
```

Never expose `RESEND_API_KEY` client-side.

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

Configure the active season in Admin -> Season -> Season settings. Choose
`football_data`, select the base competition, and save. The UI fills the
competition name and provider id automatically.

Keep `fixture_import_enabled = false` until dry-run output is reviewed. Keep
`result_sync_enabled = false` until selected-fixture result sync has been
tested for the season. Dry-run result sync remains available while disabled;
real manual and cron sync require `result_sync_enabled = true`.

football-data.org free tier is limited to 10 requests/minute. Import routes
make one provider request per import and return a clear 429 error with
`x_requestcounter_reset` if the provider limit is reached. Avoid repeated manual
imports inside the same minute.

Dry-run locally while logged in as an admin:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"season_id":"<season_id>","dry_run":1}' \
  "http://localhost:3000/api/admin/external-fixtures/import"
```

Browser-based dry-run is also available when already signed in as admin:

```text
http://localhost:3000/api/admin/external-fixtures/import?season_id=<season_id>&dry_run=1
```

A real import requires `fixture_import_enabled = true` for the target season.
Enable it from Admin -> Season -> Season settings after reviewing dry-run
output:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"season_id":"<season_id>","dry_run":0}' \
  "http://localhost:3000/api/admin/external-fixtures/import"
```

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

1. Confirm Admin -> Season -> Season settings has `football_data` and `WC`.
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

Admins can also add cached external fixtures from Admin -> Gameweeks. The admin
card reads the same local `external_fixtures` cache, does not call
football-data.org from the browser, copies the same provenance fields into
`fixtures`, and rejects duplicates that are already selected in another active
season gameweek. Manual fixture entry remains available underneath for
overrides.

Special fixtures from another competition:

- Use the Browse competition selector in `/pick-fixtures` or Admin -> Gameweeks.
- Alternate competitions must already exist in `external_competitions` and have
  cached rows in `external_fixtures`.
- The UI labels this as a special fixture override when the selected
  competition is not the season base competition.
- If a selected cached or manual fixture is outside the usual gameweek timing
  window, the app shows a warning and requires an "add it anyway" confirmation.
- The timing window is inferred from already selected fixtures for the
  gameweek. If none exist yet, it falls back to the next base-competition
  external group. A 12-hour buffer is applied on either side to avoid noisy
  warnings for normal weekend spread.
- The warning is not a hard block; it is there to catch accidental wrong-week
  selections while still allowing cup ties and moved fixtures.

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

Admins can toggle Double Gameweek in Admin -> Gameweeks. All prediction points
in that gameweek count 2x, Jokers are disabled, and existing Joker rows for the
gameweek are removed so users do not lose a season Joker. If a completed
gameweek is toggled, the save action rescoring path recalculates completed
fixtures and the leaderboard.

### Scheduled external result sync

Fixture refresh and result sync are separate jobs:

- Fixture refresh updates upcoming team names, kickoff times, provider status,
  and round/stage metadata before kickoff.
- Result sync updates final scores after kickoff and triggers scoring,
  leaderboard recalculation, and post-result activity.

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

The route only runs when the active season has:

```text
base_provider = football_data
fixture_import_enabled = true
```

If no eligible active season is configured, it returns a skipped response and
does not call football-data.org. Refresh keeps provider calls low by fetching
the active competition window once, then updating local cache rows and selected
linked fixtures safely.

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

The route performs a real sync, not a dry-run. It only runs when an active
season has:

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
5. Review Vercel logs after the first live match window for provider errors,
   scoring updates, and duplicate-notification warnings.

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
- Check Admin -> Season
- Check Admin -> Gameweeks
- Check Vercel logs for errors

## Scheduled prediction reminders

Vercel Cron calls:

```text
/api/cron/send-prediction-reminders
```

On Vercel Hobby, cron runs once daily. The configured schedule is:

```text
0 8 * * *
```

Vercel cron schedules use UTC, so this runs at 08:00 UTC. During UK/Ireland
summer time that is 09:00 local time.

The route is now the scheduled email-notification route. It remains separate
from `/api/cron/sync-external-results` and never syncs scores.

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
24-hour reminder emails plain and transactional, with a text link instead of a
promotional-style button, to improve the chance of Primary or Updates placement.
Users can move a reminder to Primary or mark it as important to train Gmail for
future league emails.

Email preferences:

- Users manage email preferences at `/settings`.
- Missing `user_email_preferences` rows are treated as all enabled.
- `predictions_open` respects `predictions_open_enabled`.
- `predictions_24h` respects `prediction_reminders_enabled`.
- `picker_up_next` respects `picker_notifications_enabled`.
- Email footers include a Manage email preferences link.
- Opting out affects email only; dashboard activity and app access are
  unchanged.

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

1. Go to Admin -> Season.
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
4. Archive season.
5. Leave `show_in_archive = true` for real seasons.
6. Export final season backup.
7. Create next season.

## Weekly admin flow

For each gameweek:

1. Confirm the correct picker is assigned.
2. Wait for picker to select fixtures.
3. Check fixtures/kickoff times.
4. Players enter predictions.
5. After matches finish, enter results via Admin -> Gameweeks.
6. Confirm leaderboard updates.
7. Confirm activity feed updates.
8. Export season data.

## Scoring and corrections

Scores are calculated when results are saved through Admin -> Gameweeks.

If an admin enters the wrong result, correct it in Admin -> Gameweeks and save again.

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

- Admin -> Season
- Activate the correct season

### Wrong season visible to users

Fix:

- Admin -> Season
- Archive incorrect active season
- Activate correct season

### Test season appears in previous leaderboards

Fix:

- Admin -> Season
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

Current lightweight monitoring:

- Vercel runtime logs
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
