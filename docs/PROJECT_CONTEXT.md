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
components/admin/*
utils/supabase/client.ts
utils/supabase/server.ts
utils/supabase/admin.ts
utils/supabase/middleware.ts
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

### `/pick-fixtures`

Fixture picker page.

Rules:

- Only visible to the assigned picker when they have an eligible gameweek.
- Gameweek 1 is eligible immediately.
- Later gameweeks unlock after the previous gameweek is complete.
- Picker chooses exactly four fixtures.
- Picker can edit until predictions exist for that gameweek.
- Admin override happens via Admin pages, not this picker page.

### `/leaderboard`

Leaderboard page.

Current behaviour:

- Defaults to active season leaderboard.
- Supports archived season final leaderboard via `?season=<season_id>`.
- Only archived seasons with `show_in_archive = true` should appear to users.
- Archived leaderboard exposes final standings only, not old predictions.

### `/admin`

Admin hub.

Current tabs include:

- Season
- Fixtures
- Results
- Users

Season tab includes:

- Season lifecycle controls
- Gameweek generation
- Gameweek picker assignments

Future Maintenance tab should include:

- Export season data
- Health check
- Recalculate leaderboard
- Safe test-data cleanup

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
- `seasons.archived_at`
- `seasons.archived_by`

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

Scores are calculated when Admin saves results through Admin -> Results.

Expected flow:

```text
Admin enters/changes result
-> fixture row updates to completed + scores
-> scoreFixture(fixtureId) recalculates every prediction for that fixture
-> recalculateLeaderboard(seasonId) rebuilds leaderboard totals/ranks
-> activity feed updates if gameweek is complete
```

If scores are edited directly in SQL, prediction points and leaderboard are not automatically recalculated unless a scoring script/action is also run.

## League activity feed

The app uses `notifications` as an in-app activity hub.

Important examples:

- Fixtures selected
- Gameweek complete
- Weekly winners
- Biggest risers/fallers
- Next picker up

`notifications.event_key` is used to upsert/avoid duplicate activity items.

`notifications.metadata` stores structured JSON for richer rendering, for example:

- fixture list
- fixture results
- weekly leaderboard mini-table
- weekly winners
- biggest risers
- biggest fallers

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

### Middleware/proxy

`proxy.ts` calls `updateSession()` from `utils/supabase/middleware.ts`.

This is important for Supabase session refresh/navigation stability on Vercel.

## Environment variables

Required locally and on Vercel:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
LEAGUE_SIGNUP_CODE=...
```

Never expose `SUPABASE_SECRET_KEY` client-side.

## Development commands

```bash
npm run lint
npm run build
npm run dev
```

Run lint/build after meaningful changes.

## Current known next work

- Admin Maintenance tab
- Season export/backup
- Health check
- Recalculate leaderboard control
- Error handling polish
- Mobile polish
- Email reminders
- Football API integration
