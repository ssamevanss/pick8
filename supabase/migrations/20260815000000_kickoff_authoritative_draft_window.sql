begin;

-- The configured first kickoff is the authoritative initial-entry deadline.
-- A premature automation status transition must not close an otherwise-open
-- draft window, while completed matchdays always remain closed.
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
      join public.seasons on seasons.id = matchdays.season_id
      where matchdays.id = check_matchday_id
        and seasons.is_active = true
        and matchdays.status <> 'completed'
        and matchdays.locks_at is not null
        and now() < matchdays.locks_at
    );
$$;

revoke all on function public.can_submit_pick8_matchday(uuid, uuid) from public;
grant execute on function public.can_submit_pick8_matchday(uuid, uuid)
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

revoke all on function public.can_edit_pick8_entry(uuid, uuid) from public;
grant execute on function public.can_edit_pick8_entry(uuid, uuid)
to authenticated, service_role;

drop policy if exists "Active users can update own entries before lock"
on public.entries;
create policy "Active users can update own editable entries"
on public.entries
for update
to authenticated
using (public.can_edit_pick8_entry(id))
with check (
  user_id = auth.uid()
  and public.can_edit_pick8_entry(id)
);

commit;
