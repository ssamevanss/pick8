-- Lightweight social reactions/comments.
-- Safe to run more than once.

create table if not exists public.prediction_reactions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  gameweek_id uuid not null references public.gameweeks(id) on delete cascade,
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  prediction_user_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji in ('😂', '🔥', '👀', '😭', '🤝')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fixture_id, prediction_user_id, user_id)
);

create index if not exists prediction_reactions_season_idx
on public.prediction_reactions (season_id, created_at desc);

create index if not exists prediction_reactions_fixture_idx
on public.prediction_reactions (fixture_id);

create index if not exists prediction_reactions_target_idx
on public.prediction_reactions (fixture_id, prediction_user_id);

create table if not exists public.notification_reactions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  gameweek_id uuid references public.gameweeks(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji in ('😂', '🔥', '👀', '😭', '🤝')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, user_id)
);

create index if not exists notification_reactions_season_idx
on public.notification_reactions (season_id, created_at desc);

create index if not exists notification_reactions_notification_idx
on public.notification_reactions (notification_id);

create table if not exists public.notification_comments (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  gameweek_id uuid references public.gameweeks(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_comments_season_idx
on public.notification_comments (season_id, created_at desc);

create index if not exists notification_comments_notification_idx
on public.notification_comments (notification_id, created_at asc);

alter table public.prediction_reactions enable row level security;
alter table public.notification_reactions enable row level security;
alter table public.notification_comments enable row level security;

drop policy if exists "Approved users can read prediction reactions" on public.prediction_reactions;
create policy "Approved users can read prediction reactions"
on public.prediction_reactions
for select
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.status = 'approved'
  )
);

drop policy if exists "Approved users can read notification reactions" on public.notification_reactions;
create policy "Approved users can read notification reactions"
on public.notification_reactions
for select
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.status = 'approved'
  )
);

drop policy if exists "Approved users can read notification comments" on public.notification_comments;
create policy "Approved users can read notification comments"
on public.notification_comments
for select
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.status = 'approved'
  )
);
