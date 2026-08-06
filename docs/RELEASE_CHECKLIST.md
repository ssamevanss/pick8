# Football Predictor App - 1.0 Release Checklist

Use this checklist before inviting real users, launching a real season, or deploying a major production change.

## 1. Auth And Users

- Open the app while logged out and confirm protected pages redirect to `/login`.
- Sign up with a valid email, display name, password, and the correct league code.
- Try an invalid invite code and confirm email, display name, and invite code
  remain filled while passwords stay empty.
- Try mismatched signup passwords and confirm the client-side message appears.
- Confirm the new user lands on `/pending`.
- Confirm the pending user cannot access Home, Predictions, Pick Fixtures, Leaderboard, or Admin.
- Log in as an admin.
- Go to Admin -> Users.
- Approve the pending user.
- Log in as the approved user and confirm Home loads.
- Disable the user in Admin -> Users.
- Confirm the disabled user is blocked and signed out with a friendly message.
- Re-enable the user.
- Confirm the user can log in again.
- Confirm a normal player cannot open `/admin`.
- Use Forgot password from the login page.
- Confirm `/forgot-password` preserves the email after submit and shows the
  neutral success message.
- Open a Supabase password reset email in the test account and confirm it lands
  on `/reset-password`.
- Set a new password and confirm the new password can sign in.

## 2. Season Lifecycle

In Admin -> Season:

- Create a draft test season.
- Confirm draft/test season is not visible in normal player flows.
- Go to Admin -> Gameweeks.
- Generate gameweeks for the test season.
- Auto-assign fixture pickers.
- Manually change one gameweek picker.
- Save picker assignments and confirm the changed picker persists.
- Mark a test gameweek as Double Gameweek and confirm the warning copy appears.
- Unmark it and confirm the setting persists correctly.
- Activate the test season.
- Confirm activating a season archives any previously active season.
- Confirm Home, Predictions, Pick Fixtures, and current Leaderboard use only the active season.
- Archive the active test season.
- Confirm normal player flows no longer use the archived season.
- Restore the archived test season to draft.
- Activate/archive again if needed to test archive visibility.
- Turn off `Show in previous seasons` for the archived test season.
- Confirm the hidden archived test season does not appear in previous leaderboards.
- Delete only the hidden/test/draft season.
- Confirm active seasons cannot be deleted.
- Confirm visible real archived seasons cannot be deleted unless hidden or test/cup type.

## 3. Fixture Picking

- Log in as the assigned picker for an eligible active-season gameweek.
- Confirm Pick Fixtures is visible when the picker has an unlocked assigned gameweek.
- For a normal PL-style gameweek, select four fixtures with home team, away team, kickoff, and competition.
- For a WC/cup/test gameweek, select the expected available fixture count for the chosen external matchday group, such as two fixtures for a two-match block.
- Save fixtures.
- Confirm fixtures picked activity appears on Home.
- Confirm fixture-picked activity says the current fixture count, not always four.
- Log in as a non-assigned user and confirm they cannot pick fixtures for that gameweek.
- As the assigned picker, edit fixtures before any predictions exist.
- Save and confirm changes persist.
- Enter a prediction for one of the fixtures as a player.
- Return as the picker and confirm fixture editing is locked.
- Confirm kickoff times display correctly in Pick Fixtures, Predictions, and activity.
- Confirm picker-entered kickoff times match UK football kickoff times.

## 4. Predictions

- Log in as an approved player.
- Open Predictions for the active season.
- Confirm a friendly empty state appears if no fixtures are selected.
- Enter predictions for selected fixtures.
- Save predictions.
- Edit predictions before kickoff and confirm changes persist.
- Add a Joker before lock.
- Remove the Joker before lock.
- Use Jokers on three fixtures and confirm the limit is enforced.
- Confirm a fourth Joker is rejected with a friendly message.
- Mark the selected gameweek as Double Gameweek in Admin -> Gameweeks.
- Confirm Predictions shows the Double Gameweek badge, hides/disables Joker
  selection, and says all points count 2x.
- Confirm any existing Joker for that gameweek no longer counts against the
  user's season Joker allowance.
- Move a fixture into locked state by using a past kickoff or completed status in the test flow.
- Confirm locked fixtures cannot be edited.
- Confirm before kickoff users only see their own prediction.
- Confirm after lock/kickoff all predictions are visible.
- Confirm posted stale/draft/archived fixture IDs are rejected by the server action.

## 5. Results And Scoring

In Admin -> Gameweeks:

- Open a gameweek with selected fixtures.
- Confirm a friendly message appears when no fixtures exist.
- Enter both home and away scores for a fixture.
- Save results.
- Confirm fixture status becomes completed.
- Confirm predictions are scored:
  - exact score = 5
  - correct result = 3
  - incorrect = 0
  - Joker exact score = 10
  - Joker correct result = 6
- Enter only one side of a score for another fixture.
- Confirm partial score entry is rejected and blank is not treated as `0`.
- Correct a completed fixture by entering both scores again.
- Confirm predictions are re-scored.
- Confirm leaderboard totals and ranks update.
- Go to Admin -> Maintenance.
- Run Re-score completed fixtures.
- Confirm prediction points and leaderboard still match the corrected results.
- Run Recalculate active leaderboard.
- Confirm leaderboard remains correct.

## 6. Activity And Leaderboard

- Confirm fixtures picked activity appears after the expected fixture count is saved.
- Complete all fixtures in a gameweek.
- Confirm gameweek complete activity appears.
- Confirm weekly winners, weekly leaderboard, biggest risers/fallers, and next picker appear where applicable.
- Open current Leaderboard.
- Confirm active season standings load.
- Confirm rank, points, exact scores, correct results, and movement display.
- Archive a season with `show_in_archive = true`.
- Confirm it appears in Previous seasons.
- Confirm archived leaderboard shows final standings only.
- Set an archived test season to `show_in_archive = false`.
- Confirm it does not appear in Previous seasons.
- Confirm draft seasons never appear in normal leaderboard flows.

## 7. Maintenance

In Admin -> Maintenance:

- Confirm Health check loads.
- Confirm active season found check is correct.
- Confirm status/is_active consistency check is correct.
- Confirm approved user, gameweek, fixture, prediction, leaderboard, and environment checks display.
- Download a season export JSON.
- Confirm the filename includes season name/id and date.
- Open the JSON and confirm it includes:
  - `season`
  - `profiles`
  - `gameweeks`
  - `fixtures`
  - `predictions`
  - `joker_usage`
  - `leaderboard_entries`
  - safely matched `notifications`
- Confirm export note explains notification limitations.
- Run Recalculate active leaderboard.
- Confirm it completes without error.
- Run Re-score completed fixtures.
- Confirm it completes without error.
- Save the export outside Supabase/Vercel before risky admin changes.

## 8. Mobile Sanity

Check on a phone-sized viewport:

- Home
- Predictions
- Pick Fixtures
- Leaderboard
- Admin -> Overview
- Admin -> Users
- Admin -> Season
- Admin -> Gameweeks
- Admin -> Maintenance

Minimum acceptable standard:

- No horizontal page overflow.
- Bottom nav remains usable.
- Buttons are easy to tap.
- Forms are readable.
- Fixture/prediction cards fit the viewport.
- Leaderboard remains readable.
- Admin Season controls do not overflow.

## 9. Environment And Database Checks

### Pick8 MVP auth and automation

- [ ] Set server-only `PICK8_SIGNUP_CODE` in Vercel without exposing its value.
- [ ] Verify signup with email confirmation enabled and disabled; profiles must
  be trigger-created as active non-admin players with the entered display name.
- [ ] Verify `/forgot-password` → recovery email → `/auth/callback` →
  `/reset-password`, including an expired-link error.
- [ ] Confirm Supabase allows the canonical production `/auth/callback` and
  `http://localhost:3000/auth/callback` for confirmation and recovery.
- [ ] Verify all eight competition ranges exist and Refresh Competitions is
  idempotent without changing custom names, fees, or contributions.
- [ ] Confirm daily fixture sync refreshes competitions, morning reconciliation
  runs from Vercel, and the external scheduler calls `/api/cron/sync-results`
  no more frequently than every five minutes.
- [ ] Confirm ordinary pages read local data and do not poll Who You Got.

Confirm local and Vercel environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SITE_URL
SUPABASE_SECRET_KEY
PICK8_SIGNUP_CODE
RESEND_API_KEY
REMINDER_EMAIL_FROM
CRON_SECRET
```

Confirm Supabase redirect URLs include:

- Production Vercel URL
- `https://whoyougot.ie/auth/callback`
- Local development `/auth/callback` URL when testing locally

Confirm Supabase Auth password reset email uses the Supabase confirmation URL
that redirects through `/auth/callback`.

Confirm expected schema fields exist:

```text
seasons.status
seasons.season_type
seasons.description
seasons.archived_at
seasons.archived_by
seasons.created_by
seasons.show_in_archive
gameweeks.fixture_picker_id
notifications.event_key
notifications.metadata
notifications.season_id
notifications.gameweek_id
external_competitions
external_fixtures
email_notifications
```

Confirm one active season max:

```sql
select id, name, status, is_active
from public.seasons
where status = 'active' or is_active = true;
```

Confirm active season is correct:

```sql
select id, name, status, is_active, season_type, show_in_archive
from public.seasons
order by created_at desc;
```

## 10. Production Deployment

Before deploying:

```bash
npm run lint
NODE_OPTIONS=--max-old-space-size=8192 npm run build
```

Then:

- Deploy to Vercel.
- Open the production URL.
- Log in as admin.
- Check Home.
- Check Predictions.
- Check Pick Fixtures if the admin is assigned to an unlocked gameweek.
- Check Leaderboard.
- Check Admin -> Season.
- In Admin -> Season settings, confirm the active season provider/competition and import/result-sync toggles.
- Check Admin -> Gameweeks.
- Check Admin -> Maintenance.
- Dry-run prediction reminders with `dry_run=1` and confirm no emails or email logs are written.
- Test `/api/cron/sync-external-results` during an idle window and confirm it returns `api_call_count = 0`.
- Download a production baseline export before inviting users.
- Check Vercel logs.
- Check Supabase logs if anything looks wrong.

## 11. Go / No-Go For 1.0

Ready for real users when:

- Lint passes.
- Build passes.
- Active real season exists.
- Real season has 38 gameweeks.
- Pickers are assigned and reviewed.
- Real users are approved.
- Test/draft/hidden seasons are not visible to players.
- Prediction flow works.
- Joker flow works.
- Result/scoring flow works.
- Double Gameweek scoring doubles gameweek points without stacking Jokers.
- Leaderboard works.
- Archived leaderboard visibility works.
- Maintenance export works.
- Health check has no unexpected red warnings.
- External fixture import/result sync settings are correct for the active season.
- Reminder and result-sync scheduler secrets have been tested.
- `email_notifications` de-dupe table exists.
- `docs/2026-07-06-double-gameweeks.sql` has been run.
- Baseline export has been downloaded and stored safely.
- Mobile pages are usable.

Do not launch if:

- More than one active season appears in SQL.
- The real season is not active.
- Test seasons appear in previous leaderboards.
- Partial score entry is accepted.
- Prediction or fixture picker actions can affect non-active seasons.
- Result save does not update scoring/leaderboard.
- Cron endpoints accept missing or invalid secrets.
- Reminder dry-runs send email or insert email logs.
- Result sync calls football-data.org when no selected fixture is in the sync window.
- Export fails or cannot be opened.

## 12. Post-Launch Weekly Routine

Each gameweek:

- Confirm the assigned picker has selected fixtures.
- Confirm kickoff times are correct.
- Confirm predictions are open.
- Confirm reminder cron dry-run shows only incomplete users.
- If using external result sync, confirm selected linked fixtures are inside the sync window and monitor the scheduler response.
- Enter or correct results manually after fixtures complete when provider sync is unavailable or needs override.
- Check scoring and leaderboard.
- Check activity feed.
- Download a season export.
