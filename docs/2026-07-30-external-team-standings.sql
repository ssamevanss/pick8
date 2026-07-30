-- External provider standings cache.
-- Safe to run more than once.

create table if not exists public.external_team_standings (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_competition_code text not null,
  provider_season text not null default '',
  external_team_id text not null,
  team_name text not null,
  team_short_name text,
  team_tla text,
  crest_url text,
  position integer not null,
  played integer,
  won integer,
  drawn integer,
  lost integer,
  points integer,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (
    provider,
    external_competition_code,
    provider_season,
    external_team_id
  )
);

create index if not exists external_team_standings_competition_position_idx
on public.external_team_standings (
  provider,
  external_competition_code,
  provider_season,
  position
);

create index if not exists external_team_standings_team_name_idx
on public.external_team_standings (
  provider,
  external_competition_code,
  team_name
);

grant select on public.external_team_standings to authenticated;
grant select, insert, update, delete on public.external_team_standings to service_role;
