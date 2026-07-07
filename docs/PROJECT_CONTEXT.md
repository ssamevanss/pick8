# Football Predictor App - Project Context

## Purpose

The Football Predictor App is a private, invite-only web app for a group of friends to predict football scores across a season. It replaces a manual football prediction game with a mobile-friendly app that handles fixture selection, prediction entry, joker chips, result entry, scoring, leaderboard updates, and league activity updates.

The design priorities are:

1. Simple for players
2. Mobile-first
3. Cheap to host
4. Low administration once a season is running
5. Easy to extend later with email reminders, football API integration, and richer stats

## Current stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Supabase PostgreSQL
- Supabase Auth
- Vercel hosting

The app uses Supabase server/browser clients from `@supabase/ssr` and server actions for mutations.

## Repository layout

The app uses root-level `app`, not `src/app`.

Important paths:

```text
app/layout.tsx
app/robots.ts
app/login/page.tsx
app/login/actions.ts
app/forgot-password/page.tsx
app/forgot-password/actions.ts
app/auth/callback/route.ts
app/reset-password/page.tsx
app/reset-password/actions.ts
app/logout/route.ts
app/signup/page.tsx
app/signup/actions.ts
app/pending/page.tsx
app/(app)/layout.tsx
app/(app)/dashboard/page.tsx
app/(app)/predictions/page.tsx
app/(app)/predictions/actions.ts
app/(app)/pick-fixtures/page.tsx
app/(app)/pick-fixtures/actions.ts
app/(app)/admin/page.tsx
app/(app)/admin/actions.ts
app/(app)/leaderboard/page.tsx
components/AppShell.tsx
components/forms/SubmitButton.tsx
components/activity/LeagueActivityFeed.tsx
components/predictions/TeamIdentity.tsx
components/admin/*
public/team-assets/
utils/supabase/client.ts
utils/supabase/server.ts
utils/supabase/admin.ts
utils/supabase/middleware.ts
utils/football-data/client.ts
utils/team-assets.ts
utils/activity.ts
proxy.ts
```

## Core routes

### `/dashboard`

Home page / league hub.

Shows:

- Player's current action cards
- Prediction completion status
- Fixture picker status
- League activity feed

Player-facing queries should only use the active season.

### `/predictions`

Prediction entry and review page.

Rules:

- Players can enter predictions for selected fixtures.
- Predictions lock individually at fixture kickoff.
- Players can only see their own predictions before kickoff.
- After kickoff, all predictions become visible.
- Joker can be applied before kickoff.
- Double Gameweeks are marked on `gameweeks.is_double_gameweek`. In a Double
  Gameweek, all prediction points count 2x and Jokers cannot be used or stacked.
- Team visual identity uses local assets from `public/team-assets` via
  `utils/team-assets.ts`. Missing teams fall back to initials badges.
- Locked fixtures show a home/draw/away prediction split calculated from
  submitted predictions for that fixture. This is never shown before lock.
- Fixture form panels use completed app fixtures from the active season before
  the selected fixture kickoff. No external football API is called from the
  prediction screen.

### `/pick-fixtures`

Fixture picker page.

Rules:

- Only visible to the assigned picker when they have an eligible gameweek.
- Gameweek 1 is eligible immediately.
- Later gameweeks unlock after the previous gameweek is complete.
- The picker only sees the next actionable assigned active-season gameweek.
  Future gameweeks stay hidden until prior gameweeks are terminal, and stale
  completed gameweeks are skipped.
- Picker chooses the expected fixture count for the current gameweek. Standard
  league gameweeks normally use four fixtures; cup/test gameweeks can use fewer
  when the selected external matchday has fewer available fixtures.
- If the active season has a configured base provider/competition, the picker
  can select from a player-facing fixture list backed by local
  `external_fixtures`.
- The fixture list defaults to the season base competition. If enabled cached
  competitions exist, the picker/admin can intentionally browse another
  competition for special fixtures such as cup ties or European games.
- Cached external fixtures are grouped by provider matchday first, then stage or kickoff date. Provider matchday is not treated as app gameweek number.
- Selected cached fixtures are copied into the existing `fixtures` table with external provenance fields.
- When a selected cached or manual fixture falls outside the inferred usual
  gameweek timing window, the UI shows a warning and requires explicit
  confirmation. This is advisory so special fixtures remain possible.
- The picker never calls football-data.org directly.
- Picker can edit until predictions exist for that gameweek.
- Admin override happens via Admin pages, not this picker page.
- Manual fixture entry remains available as fallback.

### External fixture refresh

Upcoming external fixture refresh is separate from result sync. The cron/admin
refresh path updates local `external_fixtures` cache rows and safely propagates
team-name, kickoff-time, provider-status, and round/stage metadata changes to
selected linked app fixtures before kickoff. It does not update scores or
rescore predictions.

Rules:

- Runs only for the active `football_data` season when `fixture_import_enabled`
  is true.
- Does not call football-data.org when no eligible active season/provider is
  configured.
- Preserves manually assigned World Cup `external_matchday` values when the
  provider still returns `matchday = null`.
- For selected linked fixtures, kickoff changes can apply to non-terminal
  fixtures, while team-name changes after predictions exist only apply when the
  local team name is a placeholder such as `TBD`, `TBC`, or `Winner of`.
- Completed, void, and postponed selected fixtures are not modified by refresh.
- Manual fixtures without `external_fixture_id` are never modified by external
  fixture refresh or result sync.

### `/leaderboard`

Leaderboard page.

Current behaviour:

- Defaults to active season leaderboard.
- Supports archived season final leaderboard via `?season=<season_id>`.
- Only archived seasons with `show_in_archive = true` should appear to users.
- Archived leaderboard exposes final standings only, not old predictions.
- Supports table and chart views. Chart view uses official scored predictions
  only to build cumulative player totals by completed/scored app gameweek. It
  does not extend flat lines into future unplayed gameweeks.
- Chart view defaults to the top 10 players, can optionally show every player
  with `players=all`, has a tap/click legend to show or hide lines, and includes
  lightweight play/pause/reset animation across scored gameweeks.

### `/admin`

Admin hub.

Current tabs include:

- Overview
- Users
- Season
- Gameweeks
- Maintenance

Overview includes:

- Active season summary
- Provider/competition status
- Import/result-update status
- Quick health checks

Season includes:

- Season lifecycle controls
- Active season provider/competition/result-sync settings

Gameweeks includes:

- Gameweek generation
- Gameweek picker assignments
- Fixture management
- Cached external fixture picker
- Manual fixture fallback
- Result entry

Maintenance includes:

- Export season data
- Health checks
- Recalculate leaderboard
- Re-score completed fixtures
- External fixture import controls
- External result sync controls
- Email reminder dry-run/run visibility

2.0B adds an admin-only external fixture import endpoint:

```text
/api/admin/external-fixtures/import
```

The route supports dry-run output and, when explicitly enabled on the season,
imports provider fixtures into the local `external_fixtures` cache. 2.0C picker
selection reads that local cache and copies selected rows into gameplay
`fixtures`.

2.0D adds an admin-only manual result sync endpoint:

```text
/api/admin/external-fixtures/sync-results
```

GET requests are dry-run only. POST can update selected linked fixtures from
football-data.org batch ID results, update the matching external cache rows, and
reuse the existing scoring, leaderboard recalculation, and post-result activity
notification flow when final scores arrive.

2.0E adds protected scheduled result sync:

```text
/api/cron/sync-external-results
```

It requires `CRON_SECRET`, only runs for an active football-data season with
`result_sync_enabled = true`, and checks local selected fixtures before calling
football-data.org. If no selected fixture is inside the sync window, it returns
without making a provider request.

The Admin fixtures tab can also add selected cached external fixtures from the
local `external_fixtures` table. It uses the same external-to-local provenance
mapping as `/pick-fixtures`, keeps manual fixture entry available, and prevents
duplicate external fixture selection across the active season. Fixture-picked
activity is upserted from the current gameweek fixture count, so admin edits
before predictions do not leave stale four-fixture notifications in cup/test
seasons.

## Auth and account recovery

Signup is invite-code gated and creates pending player profiles for admin
approval. Login/signup errors use friendly copy and preserve safe non-password
fields after validation failures.

Password reset uses Supabase Auth:

- `/forgot-password` requests the reset link with a neutral success message.
- `/auth/callback` exchanges Supabase email link codes server-side.
- `/reset-password` lets the signed reset session choose a new password.

Reset links use `NEXT_PUBLIC_SITE_URL`; no app-owned Resend email is sent for
password recovery.

## User roles and statuses

### Roles

- `player`
- `admin`

### Profile statuses

- `pending`
- `approved`
- `rejected`
- `disabled`

Only approved users can access the app. Admins can approve/reject/disable/re-enable users.

## Season lifecycle

Seasons have a status:

- `draft`: admin setup/testing, hidden from normal users
- `active`: the one live season normal users see/use
- `archived`: finished/read-only season

There should only be one active season at a time.

Expected flow:

1. Create a test season as draft or active.
2. Archive or delete test seasons when finished.
3. Create the real season with 38 gameweeks.
4. Run the real season as active.
5. Archive it at the end of the year.
6. Optionally expose its final leaderboard if `show_in_archive = true`.
7. Create the next real season.

Important columns:

- `seasons.status`
- `seasons.is_active` mirrors `status = 'active'` temporarily
- `seasons.season_type`
- `seasons.show_in_archive`
- `seasons.base_provider`
- `seasons.base_competition_code`
- `seasons.base_competition_name`
- `seasons.base_competition_external_id`
- `seasons.provider_season`
- `seasons.fixture_import_enabled`
- `seasons.result_sync_enabled`
- `seasons.archived_at`
- `seasons.archived_by`

Admins can edit the provider/competition and import/result-sync toggles from
Admin -> Season -> Season settings. Normal users cannot access these controls,
and API keys remain server-side only.

## Fixture picker assignment

The source of truth is now:

```text
gameweeks.fixture_picker_id
```

The older `fixture_picker_order` table may still exist, but the preferred admin flow is direct gameweek assignment:

```text
Gameweek 1  - User A
Gameweek 2  - User B
Gameweek 3  - User C
...
Gameweek 38 - User A again
```

Admin can:

- Auto-assign all gameweeks from approved users
- Reassign unpicked gameweeks from approved users
- Manually set picker per gameweek using dropdowns

For safety, future reassignment should avoid modifying gameweeks that already have fixtures selected.

## Scoring model

Prediction scoring:

- 0 points: no prediction or incorrect result
- 3 points: correct winner/draw
- 5 points: exact score
- Joker doubles points:
  - exact score = 10
  - correct result = 6
  - incorrect = 0

Scores are calculated when Admin saves results through Admin -> Gameweeks.

Expected flow:

```text
Admin enters/changes result
-> fixture row updates to completed + scores
-> scoreFixture(fixtureId) recalculates every prediction for that fixture
-> recalculateLeaderboard(seasonId) rebuilds leaderboard totals/ranks
-> activity feed updates if gameweek is complete
```

External result sync follows the same scoring, leaderboard, and post-result
activity path after provider results are applied.

For knockout/cup fixtures, normal score predictions are scored on the
90-minute result where football-data.org provides it. The provider payload is
stored raw in `external_fixtures.raw_payload` and linked
`fixtures.external_raw_payload`; `score.regularTime` is used for prediction
scoring when available. `score.fullTime` is used for regular-duration matches.
Extra-time and penalty-shootout context can be displayed/admin-reviewed later,
but it does not change normal score-prediction points.

Live/provisional scoring:

- Cached `external_fixtures` live scores can be displayed while a fixture is in
  play.
- The Predictions page can show provisional labels such as `Live exact`,
  `Live result`, and `Off track`, plus a `Live GW points` total for the current
  user.
- The Dashboard can show the same user's live gameweek points when cached live
  scores are available.
- Provisional points are display-only. They are not written to
  `predictions.points`, and `leaderboard_entries` remains official/final.
- Provisional display uses the same 0/3/5, Joker, and Double Gameweek rules as
  final scoring, with no Joker plus Double Gameweek stacking.
- If a knockout match enters extra time, provisional display should use/freeze
  on the 90-minute `regularTime` score once available instead of extra-time or
  penalty goals.

If scores are edited directly in SQL, prediction points and leaderboard are not automatically recalculated unless a scoring script/action is also run.

## League activity feed

The app uses `notifications` as an in-app activity hub.

Important examples:

- Fixtures selected
- Gameweek complete
- Weekly winners
- Next picker up

`notifications.event_key` is used to upsert/avoid duplicate activity items.

`notifications.metadata` stores structured JSON for richer rendering, for example:

- fixture list
- fixture results
- weekly leaderboard mini-table
- weekly winners

League facts/highlights:

- When a gameweek is completed through manual result entry or external result
  sync, the app generates up to 3 extra activity items with
  `event_key = league_fact:<gameweek_id>:slot:<n>`.
- Facts are normal `notifications` rows with `type = info`, so existing
  reactions and comments work without a separate `league_facts` table.
- Metadata includes `factType`, `subjectKey`, `interestingness`, `gameweekId`,
  and `gameweekName`.
- Stable slot event keys mean rerunning result sync updates the same fact slots
  instead of creating duplicate highlights.
- Implemented MVP fact candidates include weekly high score/record, exact-score
  record or no exacts, near-perfect gameweek, popular scoreline, no one calling
  a fixture result, most-predicted outcome wrong, prediction split upset, Joker
  success/disaster, best/cold last-three-gameweek form, common season
  scoreline, easiest/hardest team to predict, and closest leaderboard gap.
- Per-gameweek riser/faller activity is suppressed until the app has a
  completed-gameweek rank snapshot table. `leaderboard_entries.previous_rank`
  can be affected by repeated scoring inside the same gameweek, so it is not
  used for weekly movement facts.

Future fact candidates:

- Lowest winning weekly score.
- Most painful near miss.
- Perfect gameweek as a distinct all-fixtures exact-score achievement.
- Most successful Joker user over the season.
- Most failed Jokers over the season.
- Team causing most prediction upsets as distinct from hardest team to predict.
- Most volatile player over the season.
- Rival/head-to-head facts between adjacent leaderboard players.
- Longest exact-score drought.
- Longest scoring streak.

Lightweight social MVP:

- Locked prediction rows support compact emoji reactions after kickoff only.
- Activity feed items support one emoji reaction per user and short comments.
- Activity comments support the same compact emoji reactions as activity items.
- Reaction/comment writes use server actions with approved-user checks.
- Prediction reactions use one current reaction per user per target prediction,
  not one reaction per emoji, to keep the UI quiet.
- Activity and comment reactions also use one current reaction per user per
  target.
- Comments are flat and capped at 240 characters. Users can delete their own
  comments; admins can delete any comment.

Header social inbox:

- The app header includes a compact notification bell backed by
  `user_notifications`.
- Inbox rows are grouped by recipient + target/type rather than one row per
  reaction/comment.
- Current grouped events include reactions to a user's prediction, reactions or
  comments on fixture-picked activity owned by that picker, replies on activity
  items a user has commented on, and reactions to a user's comment.
- Users are not notified about their own reactions/comments.
- Opening the bell does not mark notifications read automatically. Users can
  use the explicit "Mark all read" button, which updates only their own rows.

## Supabase helpers

### Browser client

`utils/supabase/client.ts`

Uses `createBrowserClient` and public Supabase env vars.

### Server client

`utils/supabase/server.ts`

Uses `createServerClient` and `cookies()`.

### Admin client

`utils/supabase/admin.ts`

Uses service role / secret key and must only be called server-side.

### football-data.org client

`utils/football-data/client.ts`

Server-only provider helper. Reads `FOOTBALL_DATA_API_KEY`, sends
`X-Auth-Token`, normalizes football-data.org match payloads, and returns
clear rate-limit errors without exposing the key.

Normalized `home_score` / `away_score` are the app's prediction-scoring score:
`score.regularTime` when available, otherwise `score.fullTime` for regular-time
matches. Raw football-data.org score objects remain available in `raw_payload`
for knockout context such as extra time, penalties, and team advancement.

football-data.org is limited to 10 requests/minute on the free tier. Provider
data is cached locally in `external_fixtures`. Player-facing picker UI reads
the local cache, not football-data.org directly.

Selected external fixture results are synced only through the admin-only
`/api/admin/external-fixtures/sync-results` route. Player-facing pages do not
call football-data.org.

### Team assets

`utils/team-assets.ts` maps known World Cup teams and Premier League clubs to
local assets under:

```text
public/team-assets/flags/
public/team-assets/crests/
```

These are app-owned lightweight SVG badges, not hotlinked provider images.
Unknown teams render as stable initials badges so fixture cards do not shift or
break when a new team appears.

### Middleware/proxy

`proxy.ts` calls `updateSession()` from `utils/supabase/middleware.ts`.

This is important for Supabase session refresh/navigation stability on Vercel.

## Environment variables

Required locally and on Vercel:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
NEXT_PUBLIC_SITE_URL=https://whoyougot.ie
SUPABASE_SECRET_KEY=...
LEAGUE_SIGNUP_CODE=...
FOOTBALL_DATA_API_KEY=...
```

Never expose `SUPABASE_SECRET_KEY` client-side.
Never expose `FOOTBALL_DATA_API_KEY` client-side.

Scheduled prediction reminders also require:

```env
RESEND_API_KEY=...
REMINDER_EMAIL_FROM=...
CRON_SECRET=...
```

Activity-mirroring emails are sent through Resend and logged in
`email_notifications` with stable `event_key` values:

- `picker_up_next:<gameweek_id>:<user_id>`
- `predictions_open:<gameweek_id>:<user_id>`
- `predictions_24h:<gameweek_id>:<user_id>`

Fixture-picked activity sends a one-time predictions-open email to approved
users once the current fixture set is complete. If fixtures are edited before
predictions exist, the in-app notification is updated, but the predictions-open
email is not resent automatically.

Users manage email preferences at `/settings`. Missing
`user_email_preferences` rows default to all categories enabled. Preferences
only affect email delivery:

- `predictions_open` -> `predictions_open_enabled`
- `predictions_24h` -> `prediction_reminders_enabled`
- `picker_up_next` -> `picker_notifications_enabled`

Email footers link to `/settings` for preference management. In-app dashboard
activity is still shown even when a user opts out of an email type.

`/api/cron/send-prediction-reminders` remains separate from result sync. It
sends missed picker-up-next emails and less-than-24-hours prediction reminders.
Reminder completeness is based on the selected/actionable fixtures in that
gameweek, so cup/test gameweeks with one or two fixtures do not require four
predictions.

Double Gameweeks are managed in Admin -> Gameweeks. Enabling one removes
Joker usage for that gameweek and completed fixtures should be rescored so the
leaderboard reflects the 2x gameweek multiplier.

## Development commands

```bash
npm run lint
npm run build
npm run dev
```

Run lint/build after meaningful changes.

## Current known next work

- Production trial monitoring and invite-user smoke testing
- Error handling polish
- Mobile polish after real-device QA
- Optional richer stats and live/provisional score display after final-score
  automation is stable
