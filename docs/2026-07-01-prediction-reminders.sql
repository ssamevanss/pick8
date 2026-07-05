begin;

create extension if not exists pgcrypto;

create table if not exists public.prediction_reminders (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id) on delete cascade,
  gameweek_id uuid references public.gameweeks(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  reminder_type text not null default 'matchday_predictions',
  reminder_date date not null default current_date,
  sent_at timestamptz not null default now(),
  constraint prediction_reminders_unique_gameweek_user_type_date
    unique (gameweek_id, user_id, reminder_type, reminder_date)
);

create index if not exists prediction_reminders_season_sent_idx
on public.prediction_reminders (season_id, sent_at desc);

create index if not exists prediction_reminders_gameweek_idx
on public.prediction_reminders (gameweek_id);

create index if not exists prediction_reminders_user_sent_idx
on public.prediction_reminders (user_id, sent_at desc);

create index if not exists prediction_reminders_type_date_idx
on public.prediction_reminders (reminder_type, reminder_date);

commit;
