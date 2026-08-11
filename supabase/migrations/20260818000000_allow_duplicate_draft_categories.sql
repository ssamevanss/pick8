begin;

-- Drafts may temporarily use the same category on multiple fixtures while a
-- player rearranges their entry. Submission still requires seven distinct
-- categories through require_complete_entry_submission().
alter table public.entry_selections
drop constraint if exists entry_selections_entry_category_unique;

create or replace function public.require_valid_submitted_entry_selections()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_entry_id uuid;
  selection_count integer;
  category_count integer;
begin
  target_entry_id := case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;

  if not exists (
    select 1 from public.entries
    where entries.id = target_entry_id
      and entries.submitted_at is not null
  ) then
    return null;
  end if;

  select count(*), count(distinct category)
  into selection_count, category_count
  from public.entry_selections
  where entry_id = target_entry_id;

  if selection_count <> 7 or category_count <> 7 then
    raise exception using
      errcode = '23514',
      message = 'Submitted entry selections must contain each Pick8 category exactly once';
  end if;

  return null;
end;
$$;

revoke all on function public.require_valid_submitted_entry_selections() from public;

drop trigger if exists entry_selections_require_valid_submitted
on public.entry_selections;
create constraint trigger entry_selections_require_valid_submitted
after insert or update or delete on public.entry_selections
deferrable initially deferred
for each row execute function public.require_valid_submitted_entry_selections();

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

  if not public.is_pick8_active(auth.uid()) or not exists (
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
