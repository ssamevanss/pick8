begin;

alter table public.notifications
add column if not exists season_id uuid
references public.seasons(id) on delete set null;

alter table public.notifications
add column if not exists gameweek_id uuid
references public.gameweeks(id) on delete set null;

update public.notifications as notification
set
  gameweek_id = gameweek.id,
  season_id = coalesce(notification.season_id, gameweek.season_id)
from public.gameweeks as gameweek
where notification.gameweek_id is null
  and notification.metadata ? 'gameweekId'
  and notification.metadata ->> 'gameweekId' = gameweek.id::text;

with event_gameweeks as (
  select
    notification.id as notification_id,
    gameweek.id as gameweek_id,
    gameweek.season_id
  from public.notifications as notification
  join public.gameweeks as gameweek
    on gameweek.id::text = split_part(notification.event_key, ':', 2)
  where notification.gameweek_id is null
    and notification.event_key ~* '^(fixtures_picked|gameweek_complete|next_picker):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
update public.notifications as notification
set
  gameweek_id = event_gameweeks.gameweek_id,
  season_id = coalesce(notification.season_id, event_gameweeks.season_id)
from event_gameweeks
where notification.id = event_gameweeks.notification_id;

update public.notifications as notification
set season_id = gameweek.season_id
from public.gameweeks as gameweek
where notification.season_id is null
  and notification.gameweek_id = gameweek.id;

create index if not exists notifications_season_created_idx
on public.notifications (season_id, created_at desc);

create index if not exists notifications_gameweek_idx
on public.notifications (gameweek_id);

commit;
