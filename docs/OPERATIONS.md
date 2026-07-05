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

Required for scheduled prediction reminder emails:

```env
RESEND_API_KEY=...
REMINDER_EMAIL_FROM="Football Predictor <reminders@example.com>"
CRON_SECRET=...
```

Never expose `RESEND_API_KEY` client-side.

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
`result_sync_enabled = false`; result sync is deferred until 2.0D.

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
5. Use the External fixtures section to select exactly four cached fixtures.
6. Save selected cached fixtures.
7. Confirm four rows were inserted into `fixtures` with:
   - `status = scheduled`
   - `external_provider = football_data`
   - `external_fixture_id` populated
   - `external_competition_code = WC`
8. Confirm the manual fallback remains visible and editable until predictions
   exist.

If a cached fixture is missing, run the admin import dry-run/real import flow
again. If a fixture was already selected in another active-season gameweek, the
picker excludes it from selectable cached fixtures.

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

The route sends `matchday_predictions` reminders when:

- the season has `status = active`
- at least one selected fixture in the gameweek kicks off today
- today is calculated using the `Europe/London` date
- at least one fixture in the gameweek has not kicked off yet
- the user has not predicted every fixture in the gameweek
- no matching reminder exists for that user, gameweek, reminder type, and date
- the email links to `NEXT_PUBLIC_SITE_URL/predictions`

Prediction reminders are matchday-only. They do not send every day for a
gameweek unless fixtures are spread across multiple days and the user still has
missing predictions on a later fixture day.

The route also sends `daily_fixture_picker` reminders when:

- the season has `status = active`
- the next actionable gameweek has an assigned fixture picker
- fewer than four fixtures have been picked
- fixture picking is unlocked and not stale
- no matching picker reminder exists for that picker, gameweek, reminder type,
  and date
- the email links to `NEXT_PUBLIC_SITE_URL/pick-fixtures`

Fixture picker reminders can repeat daily while the picker still needs to act.

### Safe testing

Use dry-run mode first. It checks due gameweeks and users but does not send
email or insert reminder logs:

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
