-- General event-keyed email notification log.
-- Safe to run more than once.

create table if not exists public.email_notifications (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id) on delete cascade,
  gameweek_id uuid references public.gameweeks(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  email_type text not null,
  event_key text not null,
  sent_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (event_key),
  unique (season_id, gameweek_id, user_id, email_type)
);

create index if not exists email_notifications_season_sent_idx
on public.email_notifications (season_id, sent_at desc);

create index if not exists email_notifications_gameweek_idx
on public.email_notifications (gameweek_id);

create index if not exists email_notifications_user_sent_idx
on public.email_notifications (user_id, sent_at desc);

create index if not exists email_notifications_type_sent_idx
on public.email_notifications (email_type, sent_at desc);
