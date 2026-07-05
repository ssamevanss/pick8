-- 2.0B external fixture cache foundation.
-- Safe to run more than once.

alter table public.seasons
add column if not exists base_provider text,
add column if not exists base_competition_code text,
add column if not exists base_competition_name text,
add column if not exists base_competition_external_id text,
add column if not exists provider_season text,
add column if not exists fixture_import_enabled boolean not null default false,
add column if not exists result_sync_enabled boolean not null default false;

create table if not exists public.external_competitions (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_competition_id text,
  external_competition_code text not null,
  name text not null,
  country text,
  type text,
  enabled boolean not null default true,
  display_order integer not null default 100,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_competition_code)
);

insert into public.external_competitions (
  provider,
  external_competition_code,
  name,
  country,
  display_order
)
values
  ('football_data', 'PL', 'Premier League', 'England', 10),
  ('football_data', 'PD', 'La Liga', 'Spain', 20),
  ('football_data', 'SA', 'Serie A', 'Italy', 30),
  ('football_data', 'BL1', 'Bundesliga', 'Germany', 40),
  ('football_data', 'FL1', 'Ligue 1', 'France', 50),
  ('football_data', 'WC', 'FIFA World Cup', 'World', 60)
on conflict (provider, external_competition_code) do update
set
  name = excluded.name,
  country = excluded.country,
  display_order = excluded.display_order,
  updated_at = now();

create table if not exists public.external_fixtures (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_fixture_id text not null,
  external_competition_id text,
  external_competition_code text not null,
  provider_season text,
  external_round text,
  external_matchday integer,
  external_stage text,
  external_group text,
  home_team text not null,
  away_team text not null,
  kickoff_at timestamptz not null,
  status text not null,
  home_score integer,
  away_score integer,
  raw_payload jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_fixture_id)
);

create index if not exists external_fixtures_competition_kickoff_idx
on public.external_fixtures (provider, external_competition_code, kickoff_at);

create index if not exists external_fixtures_status_kickoff_idx
on public.external_fixtures (status, kickoff_at);

alter table public.fixtures
add column if not exists external_provider text,
add column if not exists external_fixture_id text,
add column if not exists external_competition_code text,
add column if not exists external_round text,
add column if not exists external_matchday integer,
add column if not exists external_status text,
add column if not exists external_last_synced_at timestamptz,
add column if not exists external_raw_payload jsonb;

create index if not exists fixtures_external_fixture_idx
on public.fixtures (external_provider, external_fixture_id)
where external_provider is not null and external_fixture_id is not null;
