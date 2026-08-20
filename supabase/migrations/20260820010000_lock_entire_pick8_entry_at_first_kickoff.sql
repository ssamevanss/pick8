begin;

-- A Pick8 entry is one indivisible Matchday prediction. Its write window ends
-- at the earliest configured fixture kickoff, not at each selected fixture's
-- kickoff. Derive the deadline from fixtures here as well as maintaining
-- matchdays.locks_at through fixtures_sync_matchday_deadline.
create or replace function public.can_submit_pick8_matchday(
  check_matchday_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
volatile
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
        and clock_timestamp() < (
          select min(fixtures.kickoff_at)
          from public.fixtures
          where fixtures.matchday_id = matchdays.id
        )
    );
$$;

create or replace function public.can_edit_pick8_entry(
  check_entry_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.entries
    where entries.id = check_entry_id
      and entries.user_id = check_user_id
      and public.can_submit_pick8_matchday(entries.matchday_id, check_user_id)
  );
$$;

create or replace function public.can_edit_pick8_selection(
  check_entry_id uuid,
  check_fixture_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select public.can_edit_pick8_entry(check_entry_id, check_user_id)
    and exists (
      select 1
      from public.entries
      join public.fixtures
        on fixtures.id = check_fixture_id
       and fixtures.matchday_id = entries.matchday_id
      where entries.id = check_entry_id
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

-- This is the sole application write primitive for Pick8 entries. Entry and
-- selection changes share one PostgreSQL transaction, and any exception rolls
-- the complete operation back. clock_timestamp() is used rather than now() so
-- a request that waits on a row lock cannot retain an earlier transaction time.
create or replace function public.save_pick8_entry(
  check_matchday_id uuid,
  check_intent text,
  check_total_goals integer,
  check_selections jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  matchday_status text;
  first_kickoff timestamptz;
  target_entry public.entries%rowtype;
  supplied_count integer;
  category_count integer;
  fixture_count integer;
  valid_fixture_count integer;
  changed_count integer;
  processed_at timestamptz;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if check_intent not in ('draft', 'submit', 'save_changes') then
    raise exception using errcode = '22023', message = 'Invalid Pick8 save intent';
  end if;
  if jsonb_typeof(check_selections) <> 'array' then
    raise exception using errcode = '22023', message = 'Selections must be an array';
  end if;

  select matchdays.status
  into matchday_status
  from public.matchdays
  join public.seasons on seasons.id = matchdays.season_id
  where matchdays.id = check_matchday_id
    and seasons.is_active = true
  for update of matchdays;

  select min(fixtures.kickoff_at)
  into first_kickoff
  from public.fixtures
  where fixtures.matchday_id = check_matchday_id;

  processed_at := clock_timestamp();
  if matchday_status is null
    or matchday_status = 'completed'
    or first_kickoff is null
    or processed_at >= first_kickoff
  then
    raise exception using
      errcode = '42501',
      message = 'Matchday has locked at the first fixture kickoff';
  end if;
  if not public.can_participate_in_pick8(actor_id) then
    raise exception using errcode = '42501', message = 'Pick8 participation is not active';
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
  into supplied_count, category_count, fixture_count
  from target;

  if supplied_count > 7 or supplied_count <> fixture_count then
    raise exception using errcode = '23514', message = 'Pick8 fixture selections must be unique';
  end if;
  if check_intent in ('submit', 'save_changes') and (
    check_total_goals is null
    or check_total_goals < 0
    or check_total_goals > 100
    or supplied_count <> 7
    or category_count <> 7
  ) then
    raise exception using
      errcode = '23514',
      message = 'Entry must have all seven fixture selections and Total Goals before submission';
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
  into valid_fixture_count
  from target
  join public.fixtures
    on fixtures.id = target.fixture_id
   and fixtures.matchday_id = check_matchday_id;

  if valid_fixture_count <> supplied_count then
    raise exception using errcode = '23514', message = 'A selection fixture is not in this Matchday';
  end if;

  select entries.*
  into target_entry
  from public.entries
  where entries.user_id = actor_id
    and entries.matchday_id = check_matchday_id
  for update;

  if check_intent = 'save_changes' and target_entry.id is null then
    raise exception using errcode = '23514', message = 'There is no submitted entry to update';
  end if;
  if check_intent = 'save_changes' and target_entry.submitted_at is null then
    raise exception using errcode = '23514', message = 'There is no submitted entry to update';
  end if;
  if check_intent = 'draft' and target_entry.submitted_at is not null then
    raise exception using errcode = '23514', message = 'A submitted entry cannot be changed back to a draft';
  end if;
  if check_intent = 'submit' and target_entry.submitted_at is not null then
    raise exception using errcode = '23514', message = 'This entry is already submitted';
  end if;

  if target_entry.id is null then
    insert into public.entries (
      user_id,
      matchday_id,
      total_goals_prediction,
      submitted_at,
      updated_at
    ) values (
      actor_id,
      check_matchday_id,
      check_total_goals,
      null,
      processed_at
    )
    returning * into target_entry;
  end if;

  if check_intent = 'save_changes' then
    with target as (
      select *
      from jsonb_to_recordset(check_selections) as selection(
        category text,
        fixture_id uuid,
        selected_team_side text
      )
    )
    update public.entry_selections
    set fixture_id = target.fixture_id,
        selected_team_side = target.selected_team_side,
        updated_at = processed_at
    from target
    where entry_selections.entry_id = target_entry.id
      and entry_selections.category = target.category;

    get diagnostics changed_count = row_count;
    if changed_count <> 7 then
      raise exception using errcode = '23514', message = 'Submitted selection update was incomplete';
    end if;
  else
    delete from public.entry_selections
    where entry_selections.entry_id = target_entry.id;

    insert into public.entry_selections (
      entry_id,
      category,
      fixture_id,
      selected_team_side,
      updated_at
    )
    select
      target_entry.id,
      selection.category,
      selection.fixture_id,
      selection.selected_team_side,
      processed_at
    from jsonb_to_recordset(check_selections) as selection(
      category text,
      fixture_id uuid,
      selected_team_side text
    );
  end if;

  update public.entries
  set total_goals_prediction = check_total_goals,
      submitted_at = case
        when check_intent = 'submit' then processed_at
        else target_entry.submitted_at
      end,
      updated_at = processed_at
  where entries.id = target_entry.id
  returning * into target_entry;

  -- Reject and roll back the whole transaction if the deadline elapsed while
  -- this database operation was running.
  if clock_timestamp() >= first_kickoff then
    raise exception using
      errcode = '42501',
      message = 'Matchday has locked at the first fixture kickoff';
  end if;

  return jsonb_build_object(
    'entry_id', target_entry.id,
    'submitted_at', target_entry.submitted_at
  );
end;
$$;

revoke all on function public.save_pick8_entry(uuid, text, integer, jsonb) from public;
grant execute on function public.save_pick8_entry(uuid, text, integer, jsonb)
to authenticated, service_role;

-- Keep the legacy RPC safe for any stale client or direct caller. It remains
-- transactional, but now uses the whole-Matchday deadline.
create or replace function public.replace_submitted_pick8_selections(
  check_entry_id uuid,
  check_selections jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_matchday_id uuid;
  supplied_count integer;
  category_count integer;
  fixture_count integer;
  valid_fixture_count integer;
  changed_count integer;
  first_kickoff timestamptz;
begin
  select entries.matchday_id
  into target_matchday_id
  from public.entries
  where entries.id = check_entry_id
    and entries.user_id = auth.uid()
    and entries.submitted_at is not null
  for update;

  select min(fixtures.kickoff_at)
  into first_kickoff
  from public.fixtures
  where fixtures.matchday_id = target_matchday_id;

  if target_matchday_id is null
    or not public.can_participate_in_pick8(auth.uid())
    or first_kickoff is null
    or clock_timestamp() >= first_kickoff
  then
    raise exception using errcode = '42501', message = 'Matchday has locked at the first fixture kickoff';
  end if;
  if jsonb_typeof(check_selections) <> 'array' then
    raise exception using errcode = '22023', message = 'Selections must be an array';
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
  into supplied_count, category_count, fixture_count
  from target;

  if supplied_count <> 7 or category_count <> 7 or fixture_count <> 7 then
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
  into valid_fixture_count
  from target
  join public.fixtures
    on fixtures.id = target.fixture_id
   and fixtures.matchday_id = target_matchday_id;

  if valid_fixture_count <> 7 then
    raise exception using errcode = '23514', message = 'A selection fixture is not in this Matchday';
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
  set fixture_id = target.fixture_id,
      selected_team_side = target.selected_team_side,
      updated_at = clock_timestamp()
  from target
  where entry_selections.entry_id = check_entry_id
    and entry_selections.category = target.category;

  get diagnostics changed_count = row_count;
  if changed_count <> 7 or clock_timestamp() >= first_kickoff then
    raise exception using errcode = '42501', message = 'Matchday has locked at the first fixture kickoff';
  end if;
end;
$$;

revoke all on function public.replace_submitted_pick8_selections(uuid, jsonb) from public;
grant execute on function public.replace_submitted_pick8_selections(uuid, jsonb)
to authenticated, service_role;

-- Player entry writes must use one of the transactional functions above.
-- SELECT remains governed by the existing privacy RLS policies. Service-role
-- scoring and maintenance retain their existing table grants.
revoke insert, update, delete on table public.entries from authenticated;
revoke insert, update, delete on table public.entry_selections from authenticated;

commit;
