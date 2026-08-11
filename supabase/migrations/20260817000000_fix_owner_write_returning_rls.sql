begin;

-- INSERT ... RETURNING and first-time UPSERT policy checks evaluate SELECT
-- visibility in the same statement. The existing security-definer helpers
-- locate the new row by querying its table, but that row is not visible to the
-- helper's MVCC snapshot yet. Recognise ownership directly for entries and via
-- the already-persisted parent entry for selections. Other players retain the
-- existing per-entry/per-fixture reveal boundary.
drop policy if exists "Active users can read available entries"
on public.entries;
create policy "Active users can read available entries"
on public.entries for select to authenticated
using (
  (
    user_id = auth.uid()
    and public.is_pick8_active()
  )
  or public.can_read_pick8_entry(id)
);

create or replace function public.owns_pick8_entry(
  check_entry_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_pick8_active(auth.uid())
    and exists (
      select 1
      from public.entries
      where entries.id = check_entry_id
        and entries.user_id = auth.uid()
    );
$$;

revoke all on function public.owns_pick8_entry(uuid) from public;
grant execute on function public.owns_pick8_entry(uuid)
to authenticated, service_role;

drop policy if exists "Active users can read available selections"
on public.entry_selections;
create policy "Active users can read available selections"
on public.entry_selections for select to authenticated
using (
  public.owns_pick8_entry(entry_id)
  or public.can_read_pick8_selection(id)
);

commit;
