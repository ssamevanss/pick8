-- User-scoped social notification inbox.
-- Safe to run more than once.

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  target_type text not null,
  target_id text not null,
  grouping_key text not null,
  title text not null,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, grouping_key)
);

create index if not exists user_notifications_user_updated_idx
on public.user_notifications (user_id, updated_at desc);

create index if not exists user_notifications_user_unread_idx
on public.user_notifications (user_id, read_at)
where read_at is null;

alter table public.user_notifications enable row level security;

drop policy if exists "Users can read own inbox notifications"
on public.user_notifications;

create policy "Users can read own inbox notifications"
on public.user_notifications
for select
using (user_id = auth.uid());

drop policy if exists "Users can mark own inbox notifications read"
on public.user_notifications;

create policy "Users can mark own inbox notifications read"
on public.user_notifications
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select on public.user_notifications to authenticated;
grant update (read_at) on public.user_notifications to authenticated;
grant select, insert, update, delete on public.user_notifications to service_role;
