# Football Predictor App - Database Schema Notes

This document records the current intended database model and business rules. It should be kept up to date whenever Supabase schema changes are made.

## Enums

### `app_role`

Expected values:

- `player`
- `admin`

### `profile_status`

Expected values:

- `pending`
- `approved`
- `rejected`
- `disabled`

### `fixture_status`

Expected values:

- `scheduled`
- `locked`
- `completed`
- `postponed`
- `void`

### `notification_type`

Expected values:

- `info`
- `fixtures_selected`
- `predictions_closing`
- `results_available`
- `weekly_winner`

### `season_status`

Expected values:

- `draft`
- `active`
- `archived`

## Tables

## Non-database UI assets

Team visual identity for prediction cards is file-backed, not stored in
Supabase:

- `utils/team-assets.ts` maps known team names to asset paths.
- `public/team-assets/flags/` stores app-owned World Cup flag SVGs.
- `public/team-assets/crests/` stores app-owned lightweight club crest-style
  SVGs.

Missing teams fall back to generated initials badges. Prediction split and team
form displays are calculated from existing `predictions` and completed
`fixtures`; no schema changes are required.

## `profiles`

Represents app users and their league profile.

Important columns:

- `id`: UUID, matches Supabase Auth user id
- `display_name`
- `email`
- `role`: `app_role`
- `status`: `profile_status`

Rules:

- Only `approved` users should access the app.
- `pending` users go to `/pending`.
- `rejected` and `disabled` users are signed out.
- Admins can manage user status/role.

## `seasons`

Represents a football prediction season or trial competition.

Important columns:

- `id`
- `name`
- `is_active`
- `status`: `season_status`
- `season_type`: text, e.g. `standard`, `test`, `world_cup`
- `description`
- `show_in_archive`: boolean
- `base_provider`: optional external fixture provider, e.g. `football_data`
- `base_competition_code`: optional provider competition code, e.g. `PL`
- `base_competition_name`: optional display name, e.g. `Premier League`
- `base_competition_external_id`: optional provider competition id
- `provider_season`: optional provider season id/year
- `fixture_import_enabled`: boolean, default `false`
- `result_sync_enabled`: boolean, default `false`
- `created_by`
- `archived_at`
- `archived_by`
- `created_at`

Rules:

- Only one season should be active at a time.
- `is_active` currently mirrors `status = 'active'` for backwards compatibility.
- Normal player-facing pages should use the active season only.
- Archived seasons are read-only.
- Archived real seasons can be shown in previous season leaderboards if `show_in_archive = true`.
- Test/cup trial seasons usually have `show_in_archive = false`.
- External fixture imports are disabled by default and should only run for explicitly configured seasons.
- Result sync is triggered manually through the admin-only 2.0D endpoint until cron automation is added.
- Provider/competition fields and import/result-sync toggles are managed from
  Admin -> Season -> Season settings for the active season.

Recommended SQL additions already used:

```sql
create type public.season_status as enum ('draft', 'active', 'archived');

alter table public.seasons
add column if not exists status public.season_status not null default 'draft';

alter table public.seasons
add column if not exists archived_at timestamptz,
add column if not exists archived_by uuid references public.profiles(id),
add column if not exists created_by uuid references public.profiles(id),
add column if not exists description text,
add column if not exists season_type text not null default 'standard',
add column if not exists show_in_archive boolean not null default true;
```

External fixture columns:

```sql
alter table public.seasons
add column if not exists base_provider text,
add column if not exists base_competition_code text,
add column if not exists base_competition_name text,
add column if not exists base_competition_external_id text,
add column if not exists provider_season text,
add column if not exists fixture_import_enabled boolean not null default false,
add column if not exists result_sync_enabled boolean not null default false;
```

Only one active season:

```sql
create unique index if not exists seasons_one_active_unique
on public.seasons ((status))
where status = 'active';
```

Mirror trigger:

```sql
create or replace function public.sync_season_is_active()
returns trigger
language plpgsql
as $$
begin
  new.is_active := new.status = 'active';
  return new;
end;
$$;

drop trigger if exists sync_season_is_active_trigger on public.seasons;

create trigger sync_season_is_active_trigger
before insert or update of status
on public.seasons
for each row
execute function public.sync_season_is_active();
```

## `gameweeks`

Represents a competition week/round.

Important columns:

- `id`
- `season_id`
- `gameweek_number`
- `name`
- `fixture_picker_id`
- `is_double_gameweek`

Rules:

- Each gameweek belongs to one season.
- Source of truth for fixture picker is `gameweeks.fixture_picker_id`.
- Gameweek picker assignment is directly editable by admin.
- Auto-assignment rotates approved users across gameweeks.
- `is_double_gameweek = true` doubles all prediction points in that gameweek
  and disables Joker use for that gameweek.

## `fixtures`

Represents the selected fixtures for a gameweek.

Important columns:

- `id`
- `gameweek_id`
- `home_team`
- `away_team`
- `kickoff_at`
- `status`
- `home_score`
- `away_score`
- `external_provider`
- `external_fixture_id`
- `external_competition_code`
- `external_round`
- `external_matchday`
- `external_status`
- `external_last_synced_at`
- `external_raw_payload`

Rules:

- Normal gameweek has four selected fixtures.
- Picker can create/update fixtures until predictions exist.
- Admin can override fixtures.
- Fixture locks individually at kickoff for prediction editing.
- Completed fixtures should have scores.
- External fields record provenance only. Gameplay continues to use the core fixture columns.
- Picker UI reads local cached provider fixtures, never football-data.org directly.
- Admin result sync updates linked fixtures from provider final scores and then reuses the normal scoring/leaderboard recalculation flow.

Picker safety trigger:

```sql
create or replace function public.prevent_picker_more_than_four_fixtures()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if (
    select count(*)
    from public.fixtures f
    where f.gameweek_id = new.gameweek_id
  ) >= 4 then
    raise exception 'Fixture pickers can only select up to four fixtures';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_picker_more_than_four_fixtures_trigger on public.fixtures;

create trigger prevent_picker_more_than_four_fixtures_trigger
before insert on public.fixtures
for each row
execute function public.prevent_picker_more_than_four_fixtures();
```

External provenance columns:

```sql
alter table public.fixtures
add column if not exists external_provider text,
add column if not exists external_fixture_id text,
add column if not exists external_competition_code text,
add column if not exists external_round text,
add column if not exists external_matchday integer,
add column if not exists external_status text,
add column if not exists external_last_synced_at timestamptz,
add column if not exists external_raw_payload jsonb;

create index if not exists fixtures_external_fixture_idx
on public.fixtures (external_provider, external_fixture_id)
where external_provider is not null and external_fixture_id is not null;
```

## `external_competitions`

Caches app-approved provider competitions.

Important columns:

- `provider`
- `external_competition_id`
- `external_competition_code`
- `name`
- `country`
- `type`
- `enabled`
- `display_order`
- `raw_payload`

Seeded football-data.org codes:

- `PL`: Premier League
- `PD`: La Liga
- `SA`: Serie A
- `BL1`: Bundesliga
- `FL1`: Ligue 1
- `WC`: FIFA World Cup

## `external_fixtures`

Caches provider fixtures before any picker/admin copies selected fixtures into
the gameplay `fixtures` table.

Important columns:

- `provider`
- `external_fixture_id`
- `external_competition_id`
- `external_competition_code`
- `provider_season`
- `external_round`
- `external_matchday`
- `external_stage`
- `external_group`
- `home_team`
- `away_team`
- `kickoff_at`
- `status`
- `home_score`
- `away_score`
- `raw_payload`
- `last_synced_at`

Rules:

- Unique by `(provider, external_fixture_id)`.
- football-data.org `utcDate` is stored as a UTC instant in `kickoff_at`.
- Provider status values are cached as returned, for example `SCHEDULED`, `TIMED`, and `FINISHED`.
- The picker UI reads this local cache, not the provider API.
- Selected cached fixtures are copied/linked into gameplay `fixtures`.
- Importing external fixtures must not create gameplay fixtures automatically.
- Result sync updates the cache row for linked selected fixtures but does not overwrite manually assigned `external_matchday` values.

## `external_team_standings`

Caches provider league-table rows for local display of compact ordinal team
positions on fixture cards.

Migration:

- `docs/2026-07-30-external-team-standings.sql`

Important columns:

- `provider`
- `external_competition_code`
- `provider_season`
- `external_team_id`
- `team_name`
- `team_short_name`
- `team_tla`
- `crest_url`
- `position`
- `played`
- `won`
- `drawn`
- `lost`
- `points`
- `raw_payload`
- `updated_at`

Rules:

- Unique by `(provider, external_competition_code, provider_season, external_team_id)`.
- `provider_season` uses an empty string when the provider season is unknown, so upserts remain idempotent.
- Pages read this local cache only; they never call the provider standings endpoint.
- If no row exists for a team, the UI shows no position rather than guessing.
- Tournament/cup fixtures should not show league-table positions.

## `predictions`

Represents a user's predicted score for a fixture.

Important columns:

- `fixture_id`
- `user_id`
- `home_score`
- `away_score`
- `points`
- `is_exact_score`
- `is_correct_result`
- `created_at`
- `updated_at`

Rules:

- Unique by `fixture_id`, `user_id`.
- Predictions can be edited until fixture kickoff.
- Before kickoff, users only see their own prediction.
- After kickoff, all predictions can be shown.
- Points are recalculated when results are saved through the app.

## `joker_usage`

Represents Joker chip usage.

Important columns:

- `fixture_id`
- `user_id`
- `refunded_at`

Rules:

- Joker doubles scoring for one fixture.
- Three Jokers per season is the intended rule.
- Joker should be refunded if fixture is postponed/voided.
- Joker usage in Double Gameweeks is ignored/removed and should not count
  against the season Joker allowance.

## `leaderboard_entries`

Represents current/final leaderboard standings for a season.

Important columns:

- `season_id`
- `user_id`
- `rank`
- `previous_rank`
- `total_points`
- `weekly_points`
- `exact_scores`
- `correct_results`

Rules:

- Recalculated after results are saved.
- Used for both current standings and archived final standings.
- Archived leaderboard only exposes final standings, not old predictions.

## `notifications`

Represents in-app activity feed items.

Important columns:

- `id`
- `type`
- `title`
- `body`
- `event_key`
- `season_id`
- `gameweek_id`
- `metadata`
- `created_at`

Rules:

- `event_key` prevents duplicate generated activity.
- `season_id` scopes normal Home activity to the active season.
- `gameweek_id` supports export, cleanup, and future reminders.
- `metadata` stores structured JSON for rich UI.
- `season_id` and `gameweek_id` remain nullable so legacy notifications can be kept safely.
- League facts/highlights use normal notification rows with `type = info`,
  event keys shaped like `league_fact:<gameweek_id>:slot:<n>`, and metadata
  fields such as `factType`, `subjectKey`, and `interestingness`. No separate
  facts table is required for the MVP.

Important SQL:

```sql
alter table notifications add column if not exists event_key text;

create unique index if not exists notifications_event_key_unique
on public.notifications (event_key);

alter table public.notifications
add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.notifications
add column if not exists season_id uuid
references public.seasons(id) on delete set null;

alter table public.notifications
add column if not exists gameweek_id uuid
references public.gameweeks(id) on delete set null;

create index if not exists notifications_season_created_idx
on public.notifications (season_id, created_at desc);

create index if not exists notifications_gameweek_idx
on public.notifications (gameweek_id);
```

## Social reactions and comments

Lightweight social features are stored separately from gameplay tables so they
do not affect scoring, leaderboard recalculation, result sync, or fixture
locking.

### `prediction_reactions`

Represents one emoji reaction from an approved user to another user's visible
prediction.

Important columns:

- `season_id`
- `gameweek_id`
- `fixture_id`
- `prediction_user_id`: the user whose prediction is being reacted to
- `user_id`: the reacting user
- `emoji`

Rules:

- Unique by `(fixture_id, prediction_user_id, user_id)`, so each user has one
  current reaction per prediction.
- Users can change reaction by selecting a different emoji.
- Selecting the same emoji again removes the reaction.
- Server actions only allow prediction reactions after the fixture is locked,
  preserving pre-kickoff prediction privacy.
- The MVP allowed emoji set is `😂`, `🔥`, `👀`, `😭`, and `🤝`.

### `notification_reactions`

Represents one emoji reaction from an approved user to a league activity item.

Important columns:

- `season_id`
- `gameweek_id`
- `notification_id`
- `user_id`
- `emoji`

Rules:

- Unique by `(notification_id, user_id)`, so each user has one current reaction
  per activity item.
- Reactions are shown on active-season dashboard activity only.

### `notification_comments`

Represents short comments under league activity items.

Important columns:

- `season_id`
- `gameweek_id`
- `notification_id`
- `user_id`
- `body`

Rules:

- Comments are capped at 240 characters.
- Approved users can comment on active-season activity.
- Users can delete their own comments. Admins can delete any comment.
- Comments are intentionally flat, not deeply threaded.

### `notification_comment_reactions`

Represents one emoji reaction from an approved user to a league activity
comment.

Important columns:

- `season_id`
- `gameweek_id`
- `comment_id`
- `user_id`
- `emoji`

Rules:

- Unique by `(comment_id, user_id)`, so each user has one current reaction per
  comment.
- Users can change reaction by selecting a different emoji.
- Selecting the same emoji again removes the reaction.
- The MVP allowed emoji set is `😂`, `🔥`, `👀`, `😭`, and `🤝`.

Migration:

```text
docs/2026-07-06-social-reactions.sql
docs/2026-07-07-comment-reactions.sql
```

## `prediction_reminders`

Legacy log for the original daily prediction reminder cron.

Important columns:

- `id`
- `season_id`
- `gameweek_id`
- `user_id`
- `reminder_type`
- `reminder_date`
- `sent_at`

Rules:

- One row means one reminder email was sent.
- `reminder_type` is currently `matchday_predictions` or `daily_fixture_picker`.
- `reminder_date` is the date key for daily reminder de-duplication.
- Unique constraint on `(gameweek_id, user_id, reminder_type, reminder_date)` prevents repeat reminders for the same user, gameweek, reminder type, and day.
- Rows are inserted only after a successful email send.

Important SQL:

```sql
create table if not exists public.prediction_reminders (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id) on delete cascade,
  gameweek_id uuid references public.gameweeks(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  reminder_type text not null default 'matchday_predictions',
  reminder_date date not null default current_date,
  sent_at timestamptz not null default now(),
  constraint prediction_reminders_unique_gameweek_user_type_date
    unique (gameweek_id, user_id, reminder_type, reminder_date)
);

create index if not exists prediction_reminders_season_sent_idx
on public.prediction_reminders (season_id, sent_at desc);

create index if not exists prediction_reminders_gameweek_idx
on public.prediction_reminders (gameweek_id);

create index if not exists prediction_reminders_user_sent_idx
on public.prediction_reminders (user_id, sent_at desc);

create index if not exists prediction_reminders_type_date_idx
on public.prediction_reminders (reminder_type, reminder_date);
```

## `email_notifications`

General event-keyed email delivery log for activity-mirroring emails.

Important columns:

- `season_id`
- `gameweek_id`
- `user_id`
- `email_type`
- `event_key`
- `sent_at`
- `metadata`

Rules:

- One row means one email was successfully sent.
- `event_key` is globally unique and prevents duplicate sends when actions or
  cron jobs are repeated.
- Current `email_type` values:
  - `picker_up_next`
  - `predictions_open`
  - `predictions_24h`
- Rows are season/gameweek/user scoped.
- Rows are inserted only after a successful Resend response.
- Dry-runs report would-send rows without inserting.

Important SQL:

```sql
create table if not exists public.email_notifications (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id) on delete cascade,
  gameweek_id uuid references public.gameweeks(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  email_type text not null,
  event_key text not null,
  sent_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (event_key),
  unique (season_id, gameweek_id, user_id, email_type)
);

create index if not exists email_notifications_season_sent_idx
on public.email_notifications (season_id, sent_at desc);

create index if not exists email_notifications_gameweek_idx
on public.email_notifications (gameweek_id);

create index if not exists email_notifications_user_sent_idx
on public.email_notifications (user_id, sent_at desc);

create index if not exists email_notifications_type_sent_idx
on public.email_notifications (email_type, sent_at desc);
```

## `user_email_preferences`

User-managed opt-outs for non-operational league emails.

Important columns:

- `user_id`
- `predictions_open_enabled`
- `prediction_reminders_enabled`
- `picker_notifications_enabled`
- `weekly_summary_enabled`
- `updated_at`

Rules:

- One row per profile.
- Missing row means all email categories are treated as enabled.
- Preferences affect email delivery only. In-app dashboard notifications still
  appear.
- Current mapping:
  - `predictions_open` checks `predictions_open_enabled`
  - `predictions_24h` checks `prediction_reminders_enabled`
  - `picker_up_next` checks `picker_notifications_enabled`
  - `weekly_summary_enabled` is reserved for future recap emails
- Users manage preferences from `/settings`.

Migration:

```text
docs/2026-07-06-user-email-preferences.sql
```

## `bug_reports`

Stores simple user-submitted issue reports from `/settings`.

Important columns:

- `user_id`
- `user_email`
- `user_name`
- `page_url`
- `user_agent`
- `message`
- `status`
- `created_at`
- `reviewed_at`
- `reviewed_by`

Rules:

- Authenticated users can insert reports for themselves.
- Normal users cannot browse the shared report table.
- Approved admins can read/update reports.
- Service-role/admin tooling can read, insert, update, and delete.
- The app stores the report before attempting the Resend email notification, so
  email failure does not lose the report.

Migration:

```text
docs/2026-07-30-bug-reports.sql
```

## `user_notifications`

User-scoped notification inbox for social activity shown by the header bell.

Important columns:

- `user_id`: recipient
- `notification_type`
- `target_type`
- `target_id`
- `grouping_key`
- `title`
- `body`
- `metadata`
- `read_at`
- `created_at`
- `updated_at`

Rules:

- Unique by `(user_id, grouping_key)` so similar events update one grouped inbox
  row instead of creating noisy duplicates.
- Metadata stores grouped actor ids/names and target context.
- Rows become unread again when a grouped event receives a new actor.
- Users can only read and mark their own inbox rows via RLS.
- Writes are performed by server actions after approved-user checks.

Current grouped event types:

- `prediction_reaction`
- `activity_reaction`
- `activity_comment`
- `activity_thread_comment`
- `comment_reaction`

Migration:

```text
docs/2026-07-07-user-notifications.sql
```

## `fixture_picker_order`

Older helper table for abstract picker rotation.

Current recommendation:

- Keep table for now to avoid unnecessary migration risk.
- Prefer not to use it in new UI.
- Current source of truth should be `gameweeks.fixture_picker_id`.
- Consider removing during later refactor if fully unused.

## Scoring logic

For each completed fixture:

```text
Exact score: 5 points
Correct result: 3 points
Incorrect: 0 points
Joker doubles points
```

Correct result means the predicted outcome matches actual outcome:

- home win
- away win
- draw

Result save flow:

```text
update fixtures.home_score / away_score / status
scoreFixture(fixtureId)
recalculateLeaderboard(seasonId)
upsert gameweek complete activity if all fixtures complete
upsert next picker activity
```

## Deleting seasons

Delete should be restricted to:

- draft seasons
- test seasons
- world_cup/cup trial seasons
- hidden archived seasons where `show_in_archive = false`

Do not allow deleting active seasons.

Deletion should remove related data in this order:

1. `joker_usage`
2. `predictions`
3. `fixtures`
4. `gameweeks`
5. `fixture_picker_order`
6. `leaderboard_entries`
7. `seasons`

Future improvement: add `season_id` to notifications so test-season activity can be deleted cleanly.
