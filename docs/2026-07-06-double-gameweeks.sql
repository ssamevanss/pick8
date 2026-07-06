-- Double Gameweek support.
-- Safe to run more than once.

alter table public.gameweeks
add column if not exists is_double_gameweek boolean not null default false;

comment on column public.gameweeks.is_double_gameweek is
'When true, all scored prediction points in this gameweek are doubled and Jokers cannot be used.';
