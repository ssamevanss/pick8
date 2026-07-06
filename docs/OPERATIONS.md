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

Configure a season with:

```sql
update public.seasons
set
  base_provider = 'football_data',
  base_competition_code = 'PL',
  base_competition_name = 'Premier League',
  base_competition_external_id = '2021',
  fixture_import_enabled = false,
  result_sync_enabled = false
where id = '<season_id>';
```

Keep `fixture_import_enabled = false` until dry-run output is reviewed. Keep
`result_sync_enabled = false` until scheduled result sync is added and tested.
The manual 2.0D admin sync endpoint can still be used for explicit checks.

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

A real import requires `fixture_import_enabled = true` for the target season:

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

1. Confirm the active season has `base_provider = 'football_data'` and
   `base_competition_code = 'WC'`.
2. Confirm `external_fixtures` has upcoming `TIMED` or `SCHEDULED` WC rows.
3. Log in as the assigned picker for an unlocked active-season gameweek.
4. Open `/pick-fixtures`.
5. Use the External fixtures section to select the available cached fixtures
   for the selected external matchday group.
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

Admins can also add cached external fixtures from Admin -> Fixtures. The admin
card reads the same local `external_fixtures` cache, does not call
football-data.org from the browser, copies the same provenance fields into
`fixtures`, and rejects duplicates that are already selected in another active
season gameweek. Manual fixture entry remains available underneath for
overrides.

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

### Scheduled external result sync

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
- Check Admin -> Results
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
```

The email layer sends/logs:

- `picker_up_next`: one email to the assigned picker when a gameweek becomes
  actionable. It is triggered by post-result activity and also checked by cron
  as a fallback.
- `predictions_open`: one email per approved user when the current fixture set
  is saved and complete.
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
5. After matches finish, enter results via Admin -> Results.
6. Confirm leaderboard updates.
7. Confirm activity feed updates.
8. Export season data.

## Scoring and corrections

Scores are calculated when results are saved through Admin -> Results.

If an admin enters the wrong result, correct it in Admin -> Results and save again.

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
