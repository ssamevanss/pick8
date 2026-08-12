begin;

-- Account access and Pick8 participation are deliberately separate. Disabling
-- participation must never hide or delete a player's historical account data.
alter table public.profiles
add column if not exists pick8_participation_active boolean not null default true;

grant update (
  pick8_participation_active
) on table public.profiles to authenticated;

create or replace function public.can_participate_in_pick8(
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
      and pick8_participation_active = true
  );
$$;

revoke all on function public.can_participate_in_pick8(uuid) from public;
grant execute on function public.can_participate_in_pick8(uuid)
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
  select public.can_participate_in_pick8(check_user_id)
    and exists (
      select 1
      from public.matchdays
      join public.seasons on seasons.id = matchdays.season_id
      where matchdays.id = check_matchday_id
        and seasons.is_active = true
        and matchdays.status <> 'completed'
        and matchdays.locks_at is not null
        and now() < matchdays.locks_at
    );
$$;

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
  select public.can_participate_in_pick8(check_user_id)
    and exists (
      select 1
      from public.entries
      join public.matchdays on matchdays.id = entries.matchday_id
      join public.seasons on seasons.id = matchdays.season_id
      where entries.id = check_entry_id
        and entries.user_id = check_user_id
        and seasons.is_active = true
        and (
          (
            matchdays.status <> 'completed'
            and matchdays.locks_at is not null
            and now() < matchdays.locks_at
          )
          or (
            entries.submitted_at is not null
            and exists (
              select 1 from public.fixtures
              where fixtures.matchday_id = entries.matchday_id
                and fixtures.kickoff_at > now()
                and fixtures.status in ('scheduled', 'timed')
            )
          )
        )
    );
$$;

create or replace function public.can_edit_pick8_selection(
  check_entry_id uuid,
  check_fixture_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_participate_in_pick8(check_user_id)
    and exists (
      select 1
      from public.entries
      join public.matchdays on matchdays.id = entries.matchday_id
      join public.seasons on seasons.id = matchdays.season_id
      join public.fixtures
        on fixtures.id = check_fixture_id
       and fixtures.matchday_id = entries.matchday_id
      where entries.id = check_entry_id
        and entries.user_id = check_user_id
        and seasons.is_active = true
        and fixtures.kickoff_at > now()
        and fixtures.status in ('scheduled', 'timed')
    );
$$;

revoke all on function public.can_submit_pick8_matchday(uuid, uuid) from public;
grant execute on function public.can_submit_pick8_matchday(uuid, uuid)
to authenticated, service_role;
revoke all on function public.can_edit_pick8_entry(uuid, uuid) from public;
grant execute on function public.can_edit_pick8_entry(uuid, uuid)
to authenticated, service_role;
revoke all on function public.can_edit_pick8_selection(uuid, uuid, uuid) from public;
grant execute on function public.can_edit_pick8_selection(uuid, uuid, uuid)
to authenticated, service_role;

create or replace function public.replace_submitted_pick8_selections(
  check_entry_id uuid,
  check_selections jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplied_count integer;
  editable_count integer;
  distinct_fixture_count integer;
  updated_count integer;
begin
  if jsonb_typeof(check_selections) <> 'array' then
    raise exception using errcode = '22023', message = 'Selections must be an array';
  end if;

  if not public.can_participate_in_pick8(auth.uid()) or not exists (
    select 1
    from public.entries
    join public.matchdays on matchdays.id = entries.matchday_id
    join public.seasons on seasons.id = matchdays.season_id
    where entries.id = check_entry_id
      and entries.user_id = auth.uid()
      and entries.submitted_at is not null
      and matchdays.status <> 'completed'
      and seasons.is_active = true
    for update of entries
  ) then
    raise exception using errcode = '42501', message = 'Submitted entry is not editable';
  end if;

  with target as (
    select *
    from jsonb_to_recordset(check_selections) as selection(
      category text,
      fixture_id uuid,
      selected_team_side text
    )
  )
  select count(*), count(distinct category), count(distinct fixture_id)
  into supplied_count, editable_count, distinct_fixture_count
  from target;

  if supplied_count < 1
    or supplied_count <> editable_count
    or supplied_count <> distinct_fixture_count
  then
    raise exception using errcode = '23514', message = 'Edited categories and fixtures must be unique';
  end if;

  with target as (
    select *
    from jsonb_to_recordset(check_selections) as selection(
      category text,
      fixture_id uuid,
      selected_team_side text
    )
  )
  select count(*)
  into editable_count
  from target
  join public.entry_selections current_selection
    on current_selection.entry_id = check_entry_id
   and current_selection.category = target.category
  where public.can_edit_pick8_selection(
      check_entry_id,
      current_selection.fixture_id,
      auth.uid()
    )
    and public.can_edit_pick8_selection(
      check_entry_id,
      target.fixture_id,
      auth.uid()
    );

  if editable_count <> supplied_count then
    raise exception using errcode = '42501', message = 'One or more selections are locked or invalid';
  end if;

  with target as (
    select *
    from jsonb_to_recordset(check_selections) as selection(
      category text,
      fixture_id uuid,
      selected_team_side text
    )
  )
  update public.entry_selections
  set
    fixture_id = target.fixture_id,
    selected_team_side = target.selected_team_side,
    updated_at = now()
  from target
  where entry_selections.entry_id = check_entry_id
    and entry_selections.category = target.category;

  get diagnostics updated_count = row_count;
  if updated_count <> supplied_count then
    raise exception using errcode = '23514', message = 'Submitted selection update was incomplete';
  end if;
end;
$$;

revoke all on function public.replace_submitted_pick8_selections(uuid, jsonb) from public;
grant execute on function public.replace_submitted_pick8_selections(uuid, jsonb)
to authenticated, service_role;

commit;
