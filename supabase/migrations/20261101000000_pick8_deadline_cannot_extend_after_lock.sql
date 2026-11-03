begin;

-- A postponed or rescheduled fixture must not extend the entry deadline after
-- that deadline has passed.
--
-- The write gates derived the deadline live from min(fixtures.kickoff_at). When
-- the earliest fixture's kickoff moved later after the deadline had elapsed
-- (a late reschedule, a delayed kickoff, a replay date for an abandoned match)
-- and another fixture had not yet kicked off, the minimum moved forward and the
-- matchday accepted entry edits again. matchdays.locks_at is the stored
-- deadline; once it has elapsed for a provider matchday it may only move
-- earlier. Before the deadline elapses nothing changes: a fixture postponed
-- ahead of its kickoff still extends the window to the next kickoff.

create or replace function public.pick8_entry_deadline(check_matchday_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when m.fixture_sync_mode = 'provider'
      and m.locks_at is not null
      and m.locks_at <= clock_timestamp()
    then least(m.locks_at, (
      select min(f.kickoff_at) from public.fixtures f where f.matchday_id = m.id))
    else (select min(f.kickoff_at) from public.fixtures f where f.matchday_id = m.id)
  end
  from public.matchdays m
  where m.id = check_matchday_id;
$$;
revoke all on function public.pick8_entry_deadline(uuid) from public, anon, authenticated;
grant execute on function public.pick8_entry_deadline(uuid) to service_role;

create or replace function public.preserve_elapsed_pick8_deadline()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fixture_sync_mode = 'provider'
    and old.locks_at is not null
    and old.locks_at <= clock_timestamp()
    and (new.locks_at is null or new.locks_at > old.locks_at)
  then
    new.locks_at := old.locks_at;
  end if;
  return new;
end;
$$;
revoke all on function public.preserve_elapsed_pick8_deadline() from public, anon, authenticated;

drop trigger if exists matchdays_preserve_elapsed_deadline on public.matchdays;
create trigger matchdays_preserve_elapsed_deadline
before update of locks_at on public.matchdays
for each row execute function public.preserve_elapsed_pick8_deadline();

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
        and clock_timestamp() < public.pick8_entry_deadline(matchdays.id)
    );
$$;

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
  rules_version smallint;
  required_categories text[];
  required_count integer;
  first_kickoff timestamptz;
  target_entry public.entries%rowtype;
  supplied_count integer;
  category_count integer;
  fixture_count integer;
  valid_category_count integer;
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

  select matchdays.status, matchdays.pick8_rules_version
  into matchday_status, rules_version
  from public.matchdays
  join public.seasons on seasons.id = matchdays.season_id
  where matchdays.id = check_matchday_id
    and seasons.is_active = true
  for update of matchdays;

  required_categories := public.pick8_categories_for_rules_version(rules_version);
  required_count := cardinality(required_categories);

  select public.pick8_entry_deadline(check_matchday_id) into first_kickoff;

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
    select * from jsonb_to_recordset(check_selections) as selection(
      category text, fixture_id uuid, selected_team_side text
    )
  )
  select count(*), count(distinct category), count(distinct fixture_id),
    count(*) filter (where category = any(required_categories))
  into supplied_count, category_count, fixture_count, valid_category_count
  from target;

  if supplied_count > required_count or supplied_count <> fixture_count then
    raise exception using errcode = '23514', message = 'Pick8 fixture selections must be unique';
  end if;
  if valid_category_count <> supplied_count then
    raise exception using errcode = '23514', message = 'A selection category is not available for this Matchday';
  end if;
  if check_intent in ('submit', 'save_changes') and (
    check_total_goals is null
    or check_total_goals < 0
    or check_total_goals > 100
    or supplied_count <> required_count
    or category_count <> required_count
  ) then
    raise exception using
      errcode = '23514',
      message = 'Entry must have every required fixture selection and Total Goals before submission';
  end if;

  with target as (
    select * from jsonb_to_recordset(check_selections) as selection(
      category text, fixture_id uuid, selected_team_side text
    )
  )
  select count(*) into valid_fixture_count
  from target
  join public.fixtures
    on fixtures.id = target.fixture_id
   and fixtures.matchday_id = check_matchday_id;

  if valid_fixture_count <> supplied_count then
    raise exception using errcode = '23514', message = 'A selection fixture is not in this Matchday';
  end if;

  select entries.* into target_entry
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
      user_id, matchday_id, total_goals_prediction, submitted_at, updated_at
    ) values (
      actor_id, check_matchday_id, check_total_goals, null, processed_at
    ) returning * into target_entry;
  end if;

  if check_intent = 'save_changes' then
    with target as (
      select * from jsonb_to_recordset(check_selections) as selection(
        category text, fixture_id uuid, selected_team_side text
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
    if changed_count <> required_count then
      raise exception using errcode = '23514', message = 'Submitted selection update was incomplete';
    end if;
  else
    delete from public.entry_selections
    where entry_selections.entry_id = target_entry.id;

    insert into public.entry_selections (
      entry_id, category, fixture_id, selected_team_side, updated_at
    )
    select target_entry.id, selection.category, selection.fixture_id,
      selection.selected_team_side, processed_at
    from jsonb_to_recordset(check_selections) as selection(
      category text, fixture_id uuid, selected_team_side text
    );
  end if;

  update public.entries
  set total_goals_prediction = check_total_goals,
      submitted_at = case when check_intent = 'submit' then processed_at else target_entry.submitted_at end,
      updated_at = processed_at
  where entries.id = target_entry.id
  returning * into target_entry;

  if clock_timestamp() >= first_kickoff then
    raise exception using errcode = '42501', message = 'Matchday has locked at the first fixture kickoff';
  end if;

  return jsonb_build_object('entry_id', target_entry.id, 'submitted_at', target_entry.submitted_at);
end;
$$;

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
  required_categories text[];
  required_count integer;
  supplied_count integer;
  category_count integer;
  fixture_count integer;
  valid_category_count integer;
  valid_fixture_count integer;
  changed_count integer;
  first_kickoff timestamptz;
begin
  select entries.matchday_id,
    public.pick8_categories_for_rules_version(matchdays.pick8_rules_version)
  into target_matchday_id, required_categories
  from public.entries
  join public.matchdays on matchdays.id = entries.matchday_id
  where entries.id = check_entry_id
    and entries.user_id = auth.uid()
    and entries.submitted_at is not null
  for update of entries;

  required_count := cardinality(required_categories);

  select public.pick8_entry_deadline(target_matchday_id) into first_kickoff;

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
    select * from jsonb_to_recordset(check_selections) as selection(
      category text, fixture_id uuid, selected_team_side text
    )
  )
  select count(*), count(distinct category), count(distinct fixture_id),
    count(*) filter (where category = any(required_categories))
  into supplied_count, category_count, fixture_count, valid_category_count
  from target;

  if supplied_count <> required_count
    or category_count <> required_count
    or fixture_count <> required_count
    or valid_category_count <> required_count
  then
    raise exception using errcode = '23514', message = 'Edited categories and fixtures must match this Matchday rules version';
  end if;

  with target as (
    select * from jsonb_to_recordset(check_selections) as selection(
      category text, fixture_id uuid, selected_team_side text
    )
  )
  select count(*) into valid_fixture_count
  from target
  join public.fixtures
    on fixtures.id = target.fixture_id
   and fixtures.matchday_id = target_matchday_id;

  if valid_fixture_count <> required_count then
    raise exception using errcode = '23514', message = 'A selection fixture is not in this Matchday';
  end if;

  with target as (
    select * from jsonb_to_recordset(check_selections) as selection(
      category text, fixture_id uuid, selected_team_side text
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
  if changed_count <> required_count or clock_timestamp() >= first_kickoff then
    raise exception using errcode = '42501', message = 'Matchday has locked at the first fixture kickoff';
  end if;
end;
$$;

commit;
