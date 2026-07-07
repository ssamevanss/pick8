# Future Multi-League Architecture

Last reviewed: 2026-07-07

This is a planning document only. It does not implement schema, code, UI, or
production behaviour.

## Summary

The current app is a single private league with one active season at a time.
That model is working well for the first production trial, but it should not be
the long-term platform shape. The future platform should let one user belong to
multiple private leagues, each with its own seasons, members, picker rotation,
leaderboard, activity feed, and invite flow.

Recommended direction:

1. Add a league abstraction internally while keeping the current UX unchanged.
2. Migrate the current active/archive seasons into one default league.
3. Scope all player-facing reads and writes by selected league season.
4. Add a league switcher.
5. Add create/join league flows.
6. Add platform-admin monitoring after the league model is stable.

The central external fixture cache should stay shared across all leagues. Do not
copy provider fixture rows per league.

## Current Model Assumptions

Current simplifying assumptions:

- There is one app-wide private league.
- `profiles.role` is both app/platform role and league admin/player role.
- `profiles.status = approved` means the user can access the only league.
- `seasons.status = active` means the current app-wide season.
- Only one season should be active at a time.
- `gameweeks.fixture_picker_id` points directly to the user assigned to pick
  fixtures for that app-wide gameweek.
- `fixtures`, `predictions`, `joker_usage`, `leaderboard_entries`,
  `notifications`, `email_notifications`, and social tables are season/gameweek
  scoped, but not league scoped.
- The dashboard, predictions, picker, leaderboard, reminders, result sync, and
  activity feed default to the active season.
- External fixture cache tables are already provider/global in spirit:
  `external_competitions` and `external_fixtures` do not belong to a season.

These assumptions are useful for a private MVP but become risky once users can
belong to multiple leagues.

## Target Concepts

### League

A league is a private prediction group.

Examples:

- Sam's Premier League group
- Office World Cup group
- Family Euros group

Leagues own membership, league admins, invite codes, and league seasons.

### League Season

A league season is one run of the game inside a league.

Examples:

- Sam's Premier League group, 2026/27 season
- Office World Cup group, 2026 tournament

The current `seasons` table could either become league-scoped directly or be
renamed conceptually to `league_seasons`. A physical rename is optional and can
wait.

### Platform Admin

A platform admin maintains the whole app:

- season templates
- season creation/archive/rollover
- provider season/competition configuration
- external fixture imports
- result sync
- provider/API health
- abusive/problematic leagues
- emergency production fixes
- global diagnostics

Platform admins are not the same as league admins.

### League Admin

A league admin manages one league:

- invite/remove members
- rename league
- manage invite codes
- optionally promote/demote league admins later
- manage picker rotation later, once the league model is stable

League admin should not initially:

- create seasons
- archive seasons
- roll over seasons
- configure provider seasons or base competitions
- run fixture import/result sync globally
- override results

Season ownership stays platform-managed for the first multi-league version.
This keeps the app closer to Fantasy Football / Super 6: users arrive and play
the current active season, while platform/maintenance admin handles the calendar
and provider setup.

Normal league admins should not override provider results or manually edit final
scores in production. Result correction should remain platform-admin only, at
least for the first multi-league version.

## Proposed Data Model

### `leagues`

New table.

Suggested columns:

```sql
id uuid primary key default gen_random_uuid(),
name text not null,
slug text,
created_by uuid not null references public.profiles(id),
status text not null default 'active',
default_base_provider text,
default_base_competition_code text,
default_base_competition_name text,
default_base_competition_external_id text,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
```

Notes:

- `status` could be `active`, `archived`, `disabled`.
- Keep provider defaults on the league for rollover convenience.
- Do not put leaderboard totals on `leagues`; those belong to league seasons.

### `league_memberships`

New table.

Suggested columns:

```sql
id uuid primary key default gen_random_uuid(),
league_id uuid not null references public.leagues(id) on delete cascade,
user_id uuid not null references public.profiles(id) on delete cascade,
role text not null default 'player',
status text not null default 'active',
joined_at timestamptz not null default now(),
invited_by uuid references public.profiles(id),
removed_at timestamptz,
removed_by uuid references public.profiles(id),
unique (league_id, user_id)
```

Role examples:

- `player`
- `league_admin`

Status examples:

- `active`
- `removed`
- `left`

Important distinction:

- `profiles.status` controls app-account approval.
- `league_memberships.status` controls access to a specific league.

### `league_invites`

New table.

Suggested columns:

```sql
id uuid primary key default gen_random_uuid(),
league_id uuid not null references public.leagues(id) on delete cascade,
code text not null unique,
created_by uuid not null references public.profiles(id),
expires_at timestamptz,
max_uses integer,
use_count integer not null default 0,
disabled_at timestamptz,
created_at timestamptz not null default now()
```

Notes:

- Use short, human-enterable codes plus full invite links.
- Rotate/regenerate invite codes from league settings.
- Joining with an expired/disabled/full invite should fail cleanly.

### `seasons` / `league_seasons`

Recommended first implementation: keep the physical table name `seasons` and
add `league_id`.

Suggested additions:

```sql
alter table public.seasons
add column if not exists league_id uuid references public.leagues(id);
```

Future conceptual fields already exist or are partially present:

- `base_provider`
- `base_competition_code`
- `base_competition_name`
- `base_competition_external_id`
- `provider_season`
- `fixture_import_enabled`
- `result_sync_enabled`
- `status`
- `show_in_archive`
- `season_type`

Important change:

- The unique active-season rule becomes one active season per league, not one
  active season globally.

Future index:

```sql
create unique index seasons_one_active_per_league_unique
on public.seasons (league_id)
where status = 'active';
```

### `gameweeks`

Existing table remains season-scoped.

Key fields:

- `season_id`
- `gameweek_number`
- `fixture_picker_id`
- `is_double_gameweek`

Picker assignments stay per gameweek. Because gameweeks belong to a league
season, no direct `league_id` is required unless performance later demands it.

### Gameplay Tables

Existing tables can remain mostly unchanged because they already attach to
season through gameweek or fixture:

- `fixtures` -> `gameweeks.season_id`
- `predictions` -> `fixtures.gameweek_id` -> `gameweeks.season_id`
- `joker_usage` -> `season_id` and fixture
- `leaderboard_entries` -> `season_id`
- `notifications` -> `season_id`, `gameweek_id`
- `email_notifications` -> `season_id`, `gameweek_id`, `user_id`
- social reaction/comment tables -> `season_id`, `gameweek_id`
- `user_notifications` -> user inbox rows with metadata/target links

For performance and RLS simplicity, some tables may later benefit from a
denormalized `league_id`, but the first migration should avoid unnecessary
duplication.

### External Fixture Cache

Keep central/shared:

- `external_competitions`
- `external_fixtures`

Do not create per-league provider fixture cache rows.

League seasons reference provider/competition settings, and selected fixtures
copy/link rows into `fixtures` as they do today.

Benefits:

- one provider import serves many leagues
- reduced football-data.org/API request volume
- consistent kickoff/team/status updates across leagues
- simpler provider outage handling

## Create League Flow

Goal: let an approved user create a new private league without platform-admin
SQL.

Flow:

1. User clicks Create league.
2. Enter league name.
3. App creates:
   - `leagues` row
   - `league_memberships` row for creator as `league_admin`
   - invite code
4. Creator can invite players.

Initial multi-league version should not require the creator to manage seasons.
Platform admin creates or attaches the current playable league season from a
season template. A later self-serve version can let creators choose base
competition and season type once the platform has stronger guardrails.

Initial picker assignment rule:

- platform-generated gameweeks can initially assign all unpicked/unlocked future
  gameweeks to the creator
- when more members join, rebalance only future untouched gameweeks

Do not rebalance:

- gameweeks with selected fixtures
- gameweeks with predictions
- locked/terminal gameweeks
- archived seasons

## Join League Flow

Goal: a user can join a private league using an invite code/link.

Flow:

1. User signs in or signs up.
2. User enters invite code or opens invite link.
3. App validates invite:
   - league exists
   - invite not disabled
   - not expired
   - below max uses if configured
   - user account is approved or enters pending approval flow
4. App creates/reactivates `league_memberships`.
5. App increments invite use count.
6. App rebalances future picker assignments for the league's active season.
7. User lands in that league.

Rebalance rules:

- include active members only
- preserve past/locked/picked gameweeks
- only update future gameweeks with no fixtures and no predictions
- keep current assigned picker when possible if reassignment would be noisy
- record activity item such as "Sam joined the league"

## Multi-League User Experience

### League Switcher

Add a compact league switcher in the app shell/header.

Rules:

- user can belong to multiple active leagues
- selected league stored in URL, cookie, or user preference
- app chooses sensible default:
  - last selected league
  - otherwise first active membership
  - otherwise create/join prompt

Possible routes:

```text
/dashboard?league=<league_id>
/predictions?league=<league_id>
/leaderboard?league=<league_id>
/pick-fixtures?league=<league_id>
```

Alternative route shape:

```text
/l/<league_slug>/dashboard
/l/<league_slug>/predictions
/l/<league_slug>/leaderboard
```

Recommendation:

- Use query/cookie first for a smaller migration.
- Consider slug routes later when create/join league is public.

### Scoped Pages

Every player-facing page should resolve:

```text
current user -> selected league membership -> active league season
```

Then scope all reads/writes to that league season.

Pages affected:

- dashboard
- predictions
- pick-fixtures
- leaderboard
- rules/contextual copy
- settings where league-specific preferences are later added

### Activity

Activity feed should show selected league only.

No cross-league leakage:

- comments
- reactions
- league facts
- fixture-picked activity
- result notifications
- social inbox target links

## Admin Model

### League Admin

League admin can:

- rename league
- manage invite codes
- remove members from the league
- promote/demote league admins later
- manage picker assignment for future gameweeks later

League admin should not:

- create/archive/roll over seasons in the first version
- configure provider season/base competition in the first version
- manually override results
- run provider result sync globally
- edit provider cache
- see other leagues
- manage platform users outside their league

### Platform Admin

Platform admin can:

- see all leagues
- monitor failed cron/import/sync jobs
- run fixture imports
- run result sync
- correct provider result issues
- inspect email delivery logs
- disable abusive leagues/invites
- run global maintenance

Current `profiles.role = admin` should become platform-admin role eventually.
League admin should move to `league_memberships.role`.

## Season Archive And Rollover

Season archive/rollover is platform-managed in the first multi-league version.
League admins and normal users mostly interact with the current active season.

Product philosophy:

- current playable season is the main UX
- archived seasons are retained read-only for history, audit, and possible Hall
  of Fame views
- old data should not be deleted in the first version
- rich archived-season management is deferred
- future optional UI can show previous winners, past leaderboards, or Hall of
  Fame summaries

### Archive Completed Season

When archiving:

- mark league season `archived`
- preserve fixtures
- preserve predictions
- preserve joker usage
- preserve leaderboard entries
- preserve activity/history
- preserve social comments/reactions
- stop reminders/result sync unless explicitly needed for correction

Archived seasons remain scoped to their league.
Normal player pages should ignore them unless the user intentionally opens a
history/archive view.

### Create Next Season

Rollover flow:

1. Platform admin starts rollover from a source/current season.
2. App copies league/default competition and provider settings.
3. App creates a new `seasons` row for the same league.
4. App generates gameweeks.
5. App resets:
   - leaderboard
   - joker allowance usage
   - predictions
   - fixture selections
   - picker rotation
6. App keeps membership list.
7. App assigns future gameweeks across active members.

Old season history remains available in that league only.

## Fixture Cache Architecture

Keep one central provider cache:

```text
football-data.org
  -> external fixture import/refresh
  -> external_competitions / external_fixtures
  -> many league seasons browse shared cached fixtures
  -> selected fixtures copied into per-league-season fixtures
```

Rules:

- Do not call provider once per league.
- Import by provider competition/date window.
- Refresh upcoming cached fixtures centrally.
- Result sync should query selected linked fixtures across eligible league
  seasons, but still batch provider IDs globally where possible.
- League season toggles decide whether a league season participates in result
  sync.

Potential result-sync evolution:

- current cron finds one active season
- future cron finds all active league seasons with `result_sync_enabled = true`
- collect selected linked fixtures in sync window
- de-duplicate provider fixture IDs
- one provider batch request per chunk
- apply results to all linked local fixtures across leagues

## Notifications And Email

### In-App Notifications

All activity should be league scoped.

Existing `notifications.season_id` is a good anchor, but future inbox rows need
league-safe metadata/targets.

Recommendations:

- activity rows remain season-scoped
- user inbox rows include enough target metadata to resolve selected league
- target URLs include league context
- comments/reactions never appear across leagues

### Email Notifications

Existing email types:

- `predictions_open`
- `predictions_24h`
- `picker_up_next`

Future requirements:

- email logs remain season/gameweek scoped
- subject/body includes league name when users belong to multiple leagues
- de-dupe keys include league season/gameweek/user/type
- reminders check league membership status
- removed members receive no league emails

Email preferences:

- current user-level preferences are enough for MVP
- later, add optional league-specific overrides:
  - global default enabled
  - per-league mute
  - per-type per-league preferences if needed

## RLS And Security

Core security rule:

```text
user can read/write league data only if they have active membership in that league
```

Recommended RLS approach:

- `profiles`: user can read limited profile info for users sharing a league
- `leagues`: user can read leagues where they have active membership
- `league_memberships`: user can read memberships for their leagues; league
  admins can manage memberships in their league
- `seasons`: readable through active membership in owning league
- `gameweeks`: readable through season league membership
- `fixtures`: readable through gameweek season league membership
- `predictions`: pre-lock privacy still applies inside the league
- `leaderboard_entries`: readable through season league membership
- `notifications/comments/reactions`: readable through season league membership
- `user_notifications`: user can read/update their own inbox only
- `external_fixtures`: readable by approved users only if needed, or via server
  queries; provider cache writes remain service-role/platform-admin only

Avoid:

- relying on client-side selected league alone
- global active-season queries
- checking only `profiles.status = approved`
- treating `profiles.role = admin` as league admin
- exposing provider API keys to league admins

## Migration Strategy From Current Schema

### Step 1: Add League Tables

Add:

- `leagues`
- `league_memberships`
- `league_invites`
- `seasons.league_id`

Create one default league:

```text
Who You Got? Default League
```

Backfill:

- all existing seasons -> default league
- all approved profiles -> active membership in default league
- current admins -> platform admin and/or default league admin

### Step 2: Replace Global Active Season

Change active season lookup from:

```text
status = active
```

to:

```text
league_id = selectedLeagueId and status = active
```

Maintain temporary fallback to default league during migration.

### Step 3: Scope Core Pages

Update:

- dashboard
- predictions
- pick-fixtures
- leaderboard
- activity feed
- reminders
- result sync
- email senders

### Step 4: Add League Switcher

Users can switch between memberships.

Ensure every route has a selected league context before showing data.

### Step 5: Add Create/Join League

Enable self-serve league creation and invite-code joins.

### Step 6: Platform Admin Monitoring

Add platform-level views:

- leagues
- active seasons
- sync/import status
- error logs
- email delivery health
- provider usage

## Phased Implementation Plan

### Phase 1 - Internal League Abstraction

No public UX change.

Tasks:

- add league tables
- backfill default league
- add helper for selected/default league
- scope active season helper by league
- update tests/manual QA

Deliverable:

- app behaves exactly as today, but every current season belongs to a league

### Phase 2 - Current Season Migration

Tasks:

- migrate existing active/archive seasons into default league
- backfill memberships
- update RLS policies
- audit all queries for global active-season assumptions

Deliverable:

- no data leaks, single-league UX preserved

### Phase 3 - League Switcher

Tasks:

- add app-shell league switcher
- persist selected league
- scope dashboard/predictions/picker/leaderboard/activity
- update notification target URLs

Deliverable:

- one user can switch between leagues manually if memberships exist

### Phase 4 - Create/Join League

Tasks:

- create league page
- invite-code generation
- join league page
- future picker assignment rebalance
- league admin settings for name, members, and invites
- keep season templates/rollover platform-admin owned

Deliverable:

- users can create and join private leagues without SQL, while the current
  playable season is still platform-managed

### Phase 5 - Platform Admin

Tasks:

- platform admin league list
- season template and rollover controls
- fixture/result sync monitoring across leagues
- provider usage/call budget diagnostics
- emergency league disable/invite disable

Deliverable:

- app can operate as a small multi-league platform

## Risks And Things To Avoid In Season 1

Avoid in the first multi-league season:

- public league discovery
- paid leagues/subscriptions
- complex per-league email preference matrix
- per-league fixture cache duplication
- allowing league admins to override official results
- global social feed across leagues
- cross-league leaderboard
- changing scoring rules per league
- supporting multiple active seasons per league
- destructive migration/renames before the league abstraction is proven

Main risks:

- accidental cross-league data leakage
- reminders sent for the wrong league
- social inbox links opening the wrong league
- result sync updating the wrong selected fixture rows
- RLS policies becoming too complex to reason about
- picker assignment rebalance changing already-picked gameweeks
- invite-code abuse or leaked invite links
- platform-admin and league-admin permissions becoming blurred

Recommended guardrail:

Keep the first multi-league implementation conservative. One league can have one
active season, one scoring model, one base competition, and private invite-only
membership. Add broader platform features only after that model has survived a
real season.
