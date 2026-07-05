# Football Predictor App - 1.0 Release Checklist

Use this checklist before inviting real users, launching a real season, or deploying a major production change.

## 1. Auth And Users

- Open the app while logged out and confirm protected pages redirect to `/login`.
- Sign up with a valid email, display name, password, and the correct league code.
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

## 2. Season Lifecycle

In Admin -> Season:

- Create a draft test season.
- Confirm draft/test season is not visible in normal player flows.
- Generate gameweeks for the test season.
- Auto-assign fixture pickers.
- Manually change one gameweek picker.
- Save picker assignments and confirm the changed picker persists.
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
- Select four fixtures with home team, away team, kickoff, and competition.
- Save fixtures.
- Confirm fixtures picked activity appears on Home.
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
- Move a fixture into locked state by using a past kickoff or completed status in the test flow.
- Confirm locked fixtures cannot be edited.
- Confirm before kickoff users only see their own prediction.
- Confirm after lock/kickoff all predictions are visible.
- Confirm posted stale/draft/archived fixture IDs are rejected by the server action.

## 5. Results And Scoring

In Admin -> Results:

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

- Confirm fixtures picked activity appears after four fixtures are saved.
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
- Admin -> Season
- Admin -> Results
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

Confirm local and Vercel environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SITE_URL
SUPABASE_SECRET_KEY
LEAGUE_SIGNUP_CODE
RESEND_API_KEY
REMINDER_EMAIL_FROM
CRON_SECRET
```

Confirm Supabase redirect URLs include:

- Production Vercel URL
- Localhost URL

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
prediction_reminders
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
- Check Admin -> Results.
- Check Admin -> Maintenance.
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
- Leaderboard works.
- Archived leaderboard visibility works.
- Maintenance export works.
- Health check has no unexpected red warnings.
- Baseline export has been downloaded and stored safely.
- Mobile pages are usable.

Do not launch if:

- More than one active season appears in SQL.
- The real season is not active.
- Test seasons appear in previous leaderboards.
- Partial score entry is accepted.
- Prediction or fixture picker actions can affect non-active seasons.
- Result save does not update scoring/leaderboard.
- Export fails or cannot be opened.

## 12. Post-Launch Weekly Routine

Each gameweek:

- Confirm the assigned picker has selected fixtures.
- Confirm kickoff times are correct.
- Confirm predictions are open.
- Enter results after fixtures complete.
- Check scoring and leaderboard.
- Check activity feed.
- Download a season export.
