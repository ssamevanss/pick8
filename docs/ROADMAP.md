# Football Predictor App - Roadmap

## Version framing

```text
1.0 = playable, private, reliable for one season
1.1 = better admin/maintenance and reminders
2.0 = football API, richer automation, polish, and advanced features
```

## Completed / mostly complete

### Authentication and access

- Supabase Auth
- Invite-only signup with league code
- Pending approval flow
- Admin approval/rejection/disable/re-enable users
- Player/admin roles
- Protected app layout

### Season structure

- Multiple seasons supported
- Season statuses:
  - draft
  - active
  - archived
- One active season at a time
- Archived season final leaderboard foundation
- Hidden archive flag via `show_in_archive`
- Restore archived season to draft
- Delete test/draft/hidden seasons

### Gameweeks and fixture picking

- Gameweek creation
- 4 fixtures per gameweek
- Fixture picker assignment per gameweek using `gameweeks.fixture_picker_id`
- Auto-assign picker rotation from approved users
- Reassign unpicked/future gameweeks
- Manual picker override per gameweek
- Picker page only visible when user is eligible
- Picker can edit fixtures until predictions exist

### Predictions

- Prediction entry page
- Score inputs
- Joker support
- Prediction locking at kickoff
- Own prediction visible before kickoff
- All predictions visible after kickoff

### Results and scoring

- Admin result entry
- Scoring on result save
- Leaderboard recalculation
- Joker double scoring
- Gameweek complete activity notification

### Leaderboard

- Current season leaderboard
- Rank, points, exact scores, correct results, movement
- Archived season final standings only
- Hidden test seasons from previous-season list

### Activity feed

- In-app league activity hub
- Fixtures selected notifications
- Gameweek complete notifications
- Weekly leaderboard mini-table
- Weekly winners
- Biggest risers/fallers
- Next picker notification

## Remaining for 1.0

### Admin Maintenance tab

Required before real launch:

- Export selected/active season data as JSON
- Health check
- Recalculate leaderboard for selected/active season
- Clear test data or delete test seasons safely

### Backup and recovery

- Manual season export before/after each gameweek
- Document restore strategy
- Keep database schema documented

### Error handling polish

- Friendly error states for failed queries/actions
- Admin warnings for missing active season
- Admin warnings for gameweeks without pickers
- Admin warnings for completed fixtures without scored predictions

### Mobile sanity pass

Check these pages on phone:

- Home
- Predictions
- Pick Fixtures
- Leaderboard
- Admin Results
- Admin Season

This does not need to be a full redesign before 1.0.

### Test data cleanup

Before launch:

- Delete or hide test seasons
- Create real season
- Generate 38 gameweeks
- Assign pickers
- Approve final users
- Export clean baseline backup

## 1.1 candidates

### Email reminders

Minimum useful reminder scope:

- 24 hours before first unlocked fixture
- 1 hour before first unlocked fixture
- Only to users with incomplete predictions
- No email if all predictions entered
- No email after kickoff

Likely stack:

- Vercel Cron
- Resend
- Supabase queries for incomplete predictions

### Weekly recap email

Could summarise:

- Results
- Weekly winner
- Biggest risers/fallers
- Current top 5
- Next picker

### More admin convenience

- Better season cleanup UI
- Export all seasons
- Import/restore from JSON
- Notification cleanup
- Better audit messages

## 1.2 / 2.0 candidates

### Football API integration

Future API should support:

- Fixture imports
- Kickoff times
- Team names
- Scores
- Match status
- Postponements
- Manual override remains available

Potential workflow:

1. Admin imports fixtures from API.
2. Picker selects from imported fixtures.
3. API updates results.
4. Admin can override any result.

### WhatsApp integration

Optional future feature. Probably not needed for MVP.

### Advanced stats

- Prediction accuracy charts
- Exact score count by player
- Weekly winners history
- Hall of Fame
- Season history
- Achievement system

### PWA / installable mobile app

Could make the private web app feel more app-like on phones.

## Recommended next build order

1. Admin Maintenance tab
2. Export selected season JSON
3. Health check
4. Recalculate leaderboard action exposed in UI
5. Documentation cleanup
6. Release checklist execution
7. Mobile sanity pass
8. Deploy test/trial season
9. Email reminders
10. Football API
