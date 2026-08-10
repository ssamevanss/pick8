begin;

-- Fixture swaps in an edited submitted Pick8 are applied as one upsert. Make
-- the per-entry fixture uniqueness check deferred until the statement ends so
-- valid swaps do not fail on a transient intermediate row.
alter table public.entry_selections
drop constraint if exists entry_selections_entry_fixture_unique;
alter table public.entry_selections
add constraint entry_selections_entry_fixture_unique
unique (entry_id, fixture_id)
deferrable initially deferred;

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
      join public.matchdays on matchdays.id = entries.matchday_id
      join public.seasons on seasons.id = matchdays.season_id
      where entries.id = check_entry_id
        and seasons.is_active = true
        and (
          entries.user_id = check_user_id
          or (
            entries.submitted_at is not null
            and exists (
              select 1 from public.fixtures
              where fixtures.matchday_id = entries.matchday_id
                and fixtures.kickoff_at <= now()
            )
          )
        )
    );
$$;

revoke all on function public.can_read_pick8_entry(uuid, uuid) from public;
grant execute on function public.can_read_pick8_entry(uuid, uuid)
to authenticated, service_role;

create or replace function public.can_read_pick8_selection(
  check_selection_id uuid,
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
      from public.entry_selections selections
      join public.entries on entries.id = selections.entry_id
      join public.fixtures on fixtures.id = selections.fixture_id
      join public.matchdays on matchdays.id = entries.matchday_id
      join public.seasons on seasons.id = matchdays.season_id
      where selections.id = check_selection_id
        and seasons.is_active = true
        and (
          entries.user_id = check_user_id
          or (
            entries.submitted_at is not null
            and fixtures.kickoff_at <= now()
          )
        )
    );
$$;

revoke all on function public.can_read_pick8_selection(uuid, uuid) from public;
grant execute on function public.can_read_pick8_selection(uuid, uuid)
to authenticated, service_role;

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
  select public.is_pick8_active(check_user_id)
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

revoke all on function public.can_edit_pick8_selection(uuid, uuid, uuid) from public;
grant execute on function public.can_edit_pick8_selection(uuid, uuid, uuid)
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
      join public.matchdays on matchdays.id = entries.matchday_id
      join public.seasons on seasons.id = matchdays.season_id
      where entries.id = check_entry_id
        and entries.user_id = check_user_id
        and seasons.is_active = true
        and (
          (matchdays.status in ('upcoming', 'open') and now() < matchdays.locks_at)
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

revoke all on function public.can_edit_pick8_entry(uuid, uuid) from public;
grant execute on function public.can_edit_pick8_entry(uuid, uuid)
to authenticated, service_role;

create or replace function public.protect_entry_system_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matchday_lock timestamptz;
begin
  if auth.role() = 'service_role' or public.is_pick8_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.user_id <> auth.uid() then
      raise exception 'Entry user must match the authenticated user';
    end if;
    if new.locked_at is not null or new.calculated_score is not null
      or new.score_calculated_at is not null then
      raise exception 'Players cannot set entry lock or scoring fields';
    end if;
  else
    if new.user_id is distinct from old.user_id
      or new.matchday_id is distinct from old.matchday_id
      or new.locked_at is distinct from old.locked_at
      or new.calculated_score is distinct from old.calculated_score
      or new.score_calculated_at is distinct from old.score_calculated_at then
      raise exception 'Players cannot change entry ownership, lock, or scoring fields';
    end if;
    if old.submitted_at is not null and new.submitted_at is null then
      raise exception 'Submitted entries cannot be changed back to drafts';
    end if;
    select locks_at into matchday_lock
    from public.matchdays where id = old.matchday_id;
    if matchday_lock is not null and now() >= matchday_lock
      and (
        new.total_goals_prediction is distinct from old.total_goals_prediction
        or new.submitted_at is distinct from old.submitted_at
      ) then
      raise exception 'Submission and Total Goals are locked at the first kickoff';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_submitted_entry_selections()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'service_role' or public.is_pick8_admin() then
    return old;
  end if;
  if exists (
    select 1 from public.entries
    where entries.id = old.entry_id
      and entries.submitted_at is not null
  ) then
    raise exception 'Submitted selections must be replaced, not deleted';
  end if;
  return old;
end;
$$;

drop trigger if exists entry_selections_protect_submitted_delete
on public.entry_selections;
create trigger entry_selections_protect_submitted_delete
before delete on public.entry_selections
for each row execute function public.protect_submitted_entry_selections();

revoke all on function public.protect_submitted_entry_selections() from public;

drop policy if exists "Active users can read available selections"
on public.entry_selections;
create policy "Active users can read available selections"
on public.entry_selections for select to authenticated
using (public.can_read_pick8_selection(id));

drop policy if exists "Active users can create own selections before lock"
on public.entry_selections;
create policy "Active users can create own selections before fixture kickoff"
on public.entry_selections for insert to authenticated
with check (public.can_edit_pick8_selection(entry_id, fixture_id));

drop policy if exists "Active users can update own selections before lock"
on public.entry_selections;
create policy "Active users can update own selections before fixture kickoff"
on public.entry_selections for update to authenticated
using (public.can_edit_pick8_selection(entry_id, fixture_id))
with check (public.can_edit_pick8_selection(entry_id, fixture_id));

drop policy if exists "Active users can delete own selections before lock"
on public.entry_selections;
create policy "Active users can delete own selections before fixture kickoff"
on public.entry_selections for delete to authenticated
using (public.can_edit_pick8_selection(entry_id, fixture_id));

commit;
