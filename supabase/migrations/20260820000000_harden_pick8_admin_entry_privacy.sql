begin;

-- Operational admins use narrowly scoped server-side status queries. They do
-- not need direct authenticated access to unrevealed entries or selections.
drop policy if exists "Active admins can manage entries" on public.entries;
drop policy if exists "Active admins can manage entry selections" on public.entry_selections;

commit;
