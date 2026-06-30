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

Rules:

- Each gameweek belongs to one season.
- Source of truth for fixture picker is `gameweeks.fixture_picker_id`.
- Gameweek picker assignment is directly editable by admin.
- Auto-assignment rotates approved users across gameweeks.

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

Rules:

- Normal gameweek has four selected fixtures.
- Picker can create/update fixtures until predictions exist.
- Admin can override fixtures.
- Fixture locks individually at kickoff for prediction editing.
- Completed fixtures should have scores.

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
- `metadata`
- `created_at`

Rules:

- `event_key` prevents duplicate generated activity.
- `metadata` stores structured JSON for rich UI.
- Notifications are currently not always linked directly to season_id.
- Future improvement: add `season_id` and/or `gameweek_id` for cleanup/filtering.

Important SQL:

```sql
alter table notifications add column if not exists event_key text;

create unique index if not exists notifications_event_key_unique
on public.notifications (event_key);

alter table public.notifications
add column if not exists metadata jsonb not null default '{}'::jsonb;
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
