-- Emoji reactions on league activity comments.
-- Safe to run more than once.

create table if not exists public.notification_comment_reactions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  gameweek_id uuid references public.gameweeks(id) on delete cascade,
  comment_id uuid not null references public.notification_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji in ('😂', '🔥', '👀', '😭', '🤝')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (comment_id, user_id)
);

create index if not exists notification_comment_reactions_season_idx
on public.notification_comment_reactions (season_id, created_at desc);

create index if not exists notification_comment_reactions_comment_idx
on public.notification_comment_reactions (comment_id);

alter table public.notification_comment_reactions enable row level security;

drop policy if exists "Approved users can read notification comment reactions"
on public.notification_comment_reactions;

create policy "Approved users can read notification comment reactions"
on public.notification_comment_reactions
for select
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.status = 'approved'
  )
);
