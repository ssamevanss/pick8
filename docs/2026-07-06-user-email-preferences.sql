-- User-managed email preferences.
-- Safe to run more than once.

create table if not exists public.user_email_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  predictions_open_enabled boolean not null default true,
  prediction_reminders_enabled boolean not null default true,
  picker_notifications_enabled boolean not null default true,
  weekly_summary_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists user_email_preferences_updated_idx
on public.user_email_preferences (updated_at desc);

alter table public.user_email_preferences enable row level security;

drop policy if exists "Users can read own email preferences" on public.user_email_preferences;
create policy "Users can read own email preferences"
on public.user_email_preferences
for select
using (user_id = auth.uid());

drop policy if exists "Users can insert own email preferences" on public.user_email_preferences;
create policy "Users can insert own email preferences"
on public.user_email_preferences
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.status = 'approved'
  )
);

drop policy if exists "Users can update own email preferences" on public.user_email_preferences;
create policy "Users can update own email preferences"
on public.user_email_preferences
for update
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.status = 'approved'
  )
);
