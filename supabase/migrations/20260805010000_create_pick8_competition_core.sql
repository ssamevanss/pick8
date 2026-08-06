begin;

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider_season integer not null unique,
  starts_at date,
  ends_at date,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seasons_name_check
    check (char_length(btrim(name)) between 1 and 100),
  constraint seasons_date_range_check
    check (starts_at is null or ends_at is null or ends_at >= starts_at)
);

create unique index seasons_one_active_unique
on public.seasons (is_active)
where is_active = true;

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  name text not null,
  start_matchday integer not null,
  end_matchday integer not null,
  entry_fee numeric(10, 2),
  overall_contribution numeric(10, 2),
  status text not null default 'upcoming',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competitions_name_check
    check (char_length(btrim(name)) between 1 and 100),
  constraint competitions_matchday_range_check
    check (
      start_matchday between 1 and 38
      and end_matchday between 1 and 38
      and end_matchday >= start_matchday
    ),
  constraint competitions_entry_fee_check
    check (entry_fee is null or entry_fee >= 0),
  constraint competitions_overall_contribution_check
    check (overall_contribution is null or overall_contribution >= 0),
  constraint competitions_status_check
    check (status in ('upcoming', 'active', 'completed'))
);

create index competitions_season_matchdays_idx
on public.competitions (season_id, start_matchday, end_matchday);

create table public.matchdays (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  matchday_number integer not null,
  status text not null default 'upcoming',
  opens_at timestamptz,
  locks_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matchdays_season_number_unique
    unique (season_id, matchday_number),
  constraint matchdays_number_check
    check (matchday_number between 1 and 38),
  constraint matchdays_status_check
    check (status in ('upcoming', 'open', 'locked', 'scoring', 'completed')),
  constraint matchdays_window_check
    check (opens_at is null or locks_at is null or locks_at > opens_at)
);

create index matchdays_season_status_idx
on public.matchdays (season_id, status, matchday_number);

create table public.fixtures (
  id uuid primary key default gen_random_uuid(),
  matchday_id uuid not null references public.matchdays(id) on delete cascade,
  external_fixture_id text not null unique,
  home_team_id integer,
  away_team_id integer,
  home_team_name text not null,
  away_team_name text not null,
  kickoff_at timestamptz not null,
  status text not null default 'scheduled',
  home_score integer,
  away_score integer,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fixtures_external_id_check
    check (char_length(btrim(external_fixture_id)) > 0),
  constraint fixtures_team_names_check
    check (
      char_length(btrim(home_team_name)) > 0
      and char_length(btrim(away_team_name)) > 0
      and btrim(home_team_name) <> btrim(away_team_name)
    ),
  constraint fixtures_distinct_team_ids_check
    check (
      home_team_id is null
      or away_team_id is null
      or home_team_id <> away_team_id
    ),
  constraint fixtures_home_score_check
    check (home_score is null or home_score >= 0),
  constraint fixtures_away_score_check
    check (away_score is null or away_score >= 0),
  constraint fixtures_status_check
    check (
      status in (
        'scheduled',
        'timed',
        'in_play',
        'paused',
        'finished',
        'postponed',
        'cancelled'
      )
    )
);

create index fixtures_matchday_kickoff_idx
on public.fixtures (matchday_id, kickoff_at);

create index fixtures_kickoff_idx
on public.fixtures (kickoff_at);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  matchday_id uuid not null references public.matchdays(id) on delete cascade,
  total_goals_prediction integer,
  submitted_at timestamptz,
  locked_at timestamptz,
  calculated_score integer,
  score_calculated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entries_user_matchday_unique unique (user_id, matchday_id),
  constraint entries_total_goals_check
    check (
      total_goals_prediction is null
      or total_goals_prediction between 0 and 100
    )
);

create index entries_matchday_idx
on public.entries (matchday_id);

create table public.entry_selections (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries(id) on delete cascade,
  category text not null,
  fixture_id uuid not null references public.fixtures(id),
  selected_team_side text,
  points_awarded integer,
  is_correct boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entry_selections_entry_category_unique unique (entry_id, category),
  constraint entry_selections_entry_fixture_unique unique (entry_id, fixture_id),
  constraint entry_selections_category_check
    check (
      category in (
        'home_win',
        'away_win',
        'draw',
        'team_win',
        'team_lose',
        'team_score',
        'clean_sheet'
      )
    ),
  constraint entry_selections_team_side_check
    check (selected_team_side is null or selected_team_side in ('home', 'away')),
  constraint entry_selections_category_side_check
    check (
      (category = 'home_win' and selected_team_side = 'home')
      or (category = 'away_win' and selected_team_side = 'away')
      or (category = 'draw' and selected_team_side is null)
      or (
        category in ('team_win', 'team_lose', 'team_score', 'clean_sheet')
        and selected_team_side in ('home', 'away')
      )
    )
);

create index entry_selections_fixture_idx
on public.entry_selections (fixture_id);

create or replace function public.validate_competition_matchday_range()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.seasons
  where id = new.season_id
  for update;

  if exists (
    select 1
    from public.competitions
    where season_id = new.season_id
      and id <> new.id
      and int4range(start_matchday, end_matchday, '[]')
        && int4range(new.start_matchday, new.end_matchday, '[]')
  ) then
    raise exception 'Competition matchday ranges cannot overlap within a season';
  end if;

  return new;
end;
$$;

drop trigger if exists competitions_validate_matchday_range
on public.competitions;
create trigger competitions_validate_matchday_range
before insert or update of season_id, start_matchday, end_matchday
on public.competitions
for each row
execute function public.validate_competition_matchday_range();

revoke all on function public.validate_competition_matchday_range()
from public;

create or replace function public.validate_entry_selection_matchday()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_matchday_id uuid;
  fixture_matchday_id uuid;
begin
  select matchday_id
  into entry_matchday_id
  from public.entries
  where id = new.entry_id;

  select matchday_id
  into fixture_matchday_id
  from public.fixtures
  where id = new.fixture_id;

  if entry_matchday_id is null
    or fixture_matchday_id is null
    or entry_matchday_id <> fixture_matchday_id
  then
    raise exception 'Selection fixture must belong to the entry matchday';
  end if;

  return new;
end;
$$;

drop trigger if exists entry_selections_validate_matchday
on public.entry_selections;
create trigger entry_selections_validate_matchday
before insert or update of entry_id, fixture_id
on public.entry_selections
for each row
execute function public.validate_entry_selection_matchday();

revoke all on function public.validate_entry_selection_matchday()
from public;

create or replace function public.protect_entry_system_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'service_role' or public.is_pick8_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.user_id <> auth.uid() then
      raise exception 'Entry user must match the authenticated user';
    end if;

    if new.locked_at is not null
      or new.calculated_score is not null
      or new.score_calculated_at is not null
    then
      raise exception 'Players cannot set entry lock or scoring fields';
    end if;
  elsif new.user_id is distinct from old.user_id
    or new.matchday_id is distinct from old.matchday_id
    or new.locked_at is distinct from old.locked_at
    or new.calculated_score is distinct from old.calculated_score
    or new.score_calculated_at is distinct from old.score_calculated_at
  then
    raise exception 'Players cannot change entry ownership, lock, or scoring fields';
  end if;

  return new;
end;
$$;

drop trigger if exists entries_protect_system_fields on public.entries;
create trigger entries_protect_system_fields
before insert or update on public.entries
for each row
execute function public.protect_entry_system_fields();

revoke all on function public.protect_entry_system_fields() from public;

create or replace function public.protect_selection_scoring_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'service_role' or public.is_pick8_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.points_awarded is not null or new.is_correct is not null then
      raise exception 'Players cannot set selection scoring fields';
    end if;
  elsif new.entry_id is distinct from old.entry_id
    or new.points_awarded is distinct from old.points_awarded
    or new.is_correct is distinct from old.is_correct
  then
    raise exception 'Players cannot change selection ownership or scoring fields';
  end if;

  return new;
end;
$$;

drop trigger if exists entry_selections_protect_scoring_fields
on public.entry_selections;
create trigger entry_selections_protect_scoring_fields
before insert or update on public.entry_selections
for each row
execute function public.protect_selection_scoring_fields();

revoke all on function public.protect_selection_scoring_fields()
from public;

create or replace function public.is_pick8_active(
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = check_user_id
      and is_active = true
  );
$$;

revoke all on function public.is_pick8_active(uuid) from public;
grant execute on function public.is_pick8_active(uuid)
to authenticated, service_role;

create or replace function public.can_access_pick8_season(
  check_season_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_pick8_active(check_user_id)
    and exists (
      select 1
      from public.seasons
      where id = check_season_id
        and is_active = true
    );
$$;

revoke all on function public.can_access_pick8_season(uuid, uuid) from public;
grant execute on function public.can_access_pick8_season(uuid, uuid)
to authenticated, service_role;

create or replace function public.can_submit_pick8_matchday(
  check_matchday_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_pick8_active(check_user_id)
    and exists (
      select 1
      from public.matchdays
      join public.seasons
        on seasons.id = matchdays.season_id
      where matchdays.id = check_matchday_id
        and seasons.is_active = true
        and matchdays.status in ('upcoming', 'open')
        and (matchdays.locks_at is null or now() < matchdays.locks_at)
    );
$$;

revoke all on function public.can_submit_pick8_matchday(uuid, uuid)
from public;
grant execute on function public.can_submit_pick8_matchday(uuid, uuid)
to authenticated, service_role;

create or replace function public.can_read_pick8_entry(
  check_entry_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_pick8_active(check_user_id)
    and exists (
      select 1
      from public.entries
      join public.matchdays
        on matchdays.id = entries.matchday_id
      join public.seasons
        on seasons.id = matchdays.season_id
      where entries.id = check_entry_id
        and seasons.is_active = true
        and (
          entries.user_id = check_user_id
          or matchdays.status in ('locked', 'scoring', 'completed')
          or (
            matchdays.locks_at is not null
            and matchdays.locks_at <= now()
          )
        )
    );
$$;

revoke all on function public.can_read_pick8_entry(uuid, uuid) from public;
grant execute on function public.can_read_pick8_entry(uuid, uuid)
to authenticated, service_role;

create or replace function public.can_edit_pick8_entry(
  check_entry_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_pick8_active(check_user_id)
    and exists (
      select 1
      from public.entries
      join public.matchdays
        on matchdays.id = entries.matchday_id
      join public.seasons
        on seasons.id = matchdays.season_id
      where entries.id = check_entry_id
        and entries.user_id = check_user_id
        and seasons.is_active = true
        and matchdays.status in ('upcoming', 'open')
        and (matchdays.locks_at is null or now() < matchdays.locks_at)
    );
$$;

revoke all on function public.can_edit_pick8_entry(uuid, uuid) from public;
grant execute on function public.can_edit_pick8_entry(uuid, uuid)
to authenticated, service_role;

drop trigger if exists seasons_set_updated_at on public.seasons;
create trigger seasons_set_updated_at
before update on public.seasons
for each row execute function public.set_updated_at();

drop trigger if exists competitions_set_updated_at on public.competitions;
create trigger competitions_set_updated_at
before update on public.competitions
for each row execute function public.set_updated_at();

drop trigger if exists matchdays_set_updated_at on public.matchdays;
create trigger matchdays_set_updated_at
before update on public.matchdays
for each row execute function public.set_updated_at();

drop trigger if exists fixtures_set_updated_at on public.fixtures;
create trigger fixtures_set_updated_at
before update on public.fixtures
for each row execute function public.set_updated_at();

drop trigger if exists entries_set_updated_at on public.entries;
create trigger entries_set_updated_at
before update on public.entries
for each row execute function public.set_updated_at();

drop trigger if exists entry_selections_set_updated_at
on public.entry_selections;
create trigger entry_selections_set_updated_at
before update on public.entry_selections
for each row execute function public.set_updated_at();

alter table public.seasons enable row level security;
alter table public.competitions enable row level security;
alter table public.matchdays enable row level security;
alter table public.fixtures enable row level security;
alter table public.entries enable row level security;
alter table public.entry_selections enable row level security;

create policy "Active users can read the active season"
on public.seasons
for select
to authenticated
using (public.can_access_pick8_season(id));

create policy "Active admins can manage seasons"
on public.seasons
for all
to authenticated
using (public.is_pick8_admin())
with check (public.is_pick8_admin());

create policy "Active users can read current competitions"
on public.competitions
for select
to authenticated
using (public.can_access_pick8_season(season_id));

create policy "Active admins can manage competitions"
on public.competitions
for all
to authenticated
using (public.is_pick8_admin())
with check (public.is_pick8_admin());

create policy "Active users can read current matchdays"
on public.matchdays
for select
to authenticated
using (public.can_access_pick8_season(season_id));

create policy "Active admins can manage matchdays"
on public.matchdays
for all
to authenticated
using (public.is_pick8_admin())
with check (public.is_pick8_admin());

create policy "Active users can read current fixtures"
on public.fixtures
for select
to authenticated
using (
  exists (
    select 1
    from public.matchdays
    where matchdays.id = fixtures.matchday_id
      and public.can_access_pick8_season(matchdays.season_id)
  )
);

create policy "Active admins can manage fixtures"
on public.fixtures
for all
to authenticated
using (public.is_pick8_admin())
with check (public.is_pick8_admin());

create policy "Active users can read available entries"
on public.entries
for select
to authenticated
using (public.can_read_pick8_entry(id));

create policy "Active users can create own entries before lock"
on public.entries
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.can_submit_pick8_matchday(matchday_id)
);

create policy "Active users can update own entries before lock"
on public.entries
for update
to authenticated
using (public.can_edit_pick8_entry(id))
with check (
  user_id = auth.uid()
  and public.can_submit_pick8_matchday(matchday_id)
);

create policy "Active users can delete own entries before lock"
on public.entries
for delete
to authenticated
using (public.can_edit_pick8_entry(id));

create policy "Active admins can manage entries"
on public.entries
for all
to authenticated
using (public.is_pick8_admin())
with check (public.is_pick8_admin());

create policy "Active users can read available selections"
on public.entry_selections
for select
to authenticated
using (public.can_read_pick8_entry(entry_id));

create policy "Active users can create own selections before lock"
on public.entry_selections
for insert
to authenticated
with check (public.can_edit_pick8_entry(entry_id));

create policy "Active users can update own selections before lock"
on public.entry_selections
for update
to authenticated
using (public.can_edit_pick8_entry(entry_id))
with check (public.can_edit_pick8_entry(entry_id));

create policy "Active users can delete own selections before lock"
on public.entry_selections
for delete
to authenticated
using (public.can_edit_pick8_entry(entry_id));

create policy "Active admins can manage entry selections"
on public.entry_selections
for all
to authenticated
using (public.is_pick8_admin())
with check (public.is_pick8_admin());

revoke all on table public.seasons from public, anon, authenticated;
revoke all on table public.competitions from public, anon, authenticated;
revoke all on table public.matchdays from public, anon, authenticated;
revoke all on table public.fixtures from public, anon, authenticated;
revoke all on table public.entries from public, anon, authenticated;
revoke all on table public.entry_selections from public, anon, authenticated;

grant select, insert, update, delete
on table
  public.seasons,
  public.competitions,
  public.matchdays,
  public.fixtures,
  public.entries,
  public.entry_selections
to authenticated;

grant select, insert, update, delete
on table
  public.seasons,
  public.competitions,
  public.matchdays,
  public.fixtures,
  public.entries,
  public.entry_selections
to service_role;

commit;
