begin;

alter table public.matchdays
add column fixture_sync_mode text not null default 'provider';

alter table public.matchdays
add constraint matchdays_fixture_sync_mode_check
check (fixture_sync_mode in ('provider', 'manual'));

-- Preserve the active accelerated Matchday 2 lifecycle test exactly as-is.
-- The presence of its known synthetic fixture IDs is the durable migration
-- signal; no fixture, selection, entry, score, or timestamp is changed.
update public.matchdays
set fixture_sync_mode = 'manual',
    updated_at = now()
where id in (
  select distinct matchday_id
  from public.fixtures
  where external_fixture_id in (
    '990002001', '990002002', '990002003', '990002004', '990002005',
    '990002006', '990002007', '990002008', '990002009', '990002010'
  )
);

create or replace function public.protect_matchday_fixture_sync_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fixture_sync_mode is not distinct from old.fixture_sync_mode then
    return new;
  end if;
  if not (auth.role() = 'service_role' or public.is_pick8_admin()) then
    raise exception 'Only administrators can change fixture sync mode';
  end if;
  if old.status in ('locked', 'scoring', 'completed')
    or exists (
      select 1 from public.fixtures
      where fixtures.matchday_id = old.id
        and fixtures.kickoff_at <= now()
    )
    or exists (
      select 1 from public.entries
      where entries.matchday_id = old.id
        and (
          entries.submitted_at is not null
          or entries.calculated_score is not null
        )
    )
  then
    raise exception 'Fixture sync mode cannot change after kickoff, submission, or scoring';
  end if;
  if new.fixture_sync_mode = 'provider' and exists (
    select 1
    from public.fixtures first_fixture
    join public.fixtures duplicate_fixture
      on duplicate_fixture.matchday_id = first_fixture.matchday_id
     and duplicate_fixture.id > first_fixture.id
     and lower(btrim(duplicate_fixture.home_team_name)) = lower(btrim(first_fixture.home_team_name))
     and lower(btrim(duplicate_fixture.away_team_name)) = lower(btrim(first_fixture.away_team_name))
    where first_fixture.matchday_id = old.id
  ) then
    raise exception 'Duplicate logical fixtures must be resolved before enabling provider sync';
  end if;
  return new;
end;
$$;

drop trigger if exists matchdays_protect_fixture_sync_mode on public.matchdays;
create trigger matchdays_protect_fixture_sync_mode
before update of fixture_sync_mode on public.matchdays
for each row execute function public.protect_matchday_fixture_sync_mode();

revoke all on function public.protect_matchday_fixture_sync_mode() from public;

create or replace function public.prevent_provider_fixture_duplicates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.matchdays
    where matchdays.id = new.matchday_id
      and matchdays.fixture_sync_mode = 'provider'
  ) and exists (
    select 1 from public.fixtures
    where fixtures.matchday_id = new.matchday_id
      and fixtures.id <> new.id
      and lower(btrim(fixtures.home_team_name)) = lower(btrim(new.home_team_name))
      and lower(btrim(fixtures.away_team_name)) = lower(btrim(new.away_team_name))
  ) then
    raise exception 'Provider matchdays cannot contain duplicate logical fixtures';
  end if;
  return new;
end;
$$;

drop trigger if exists fixtures_prevent_provider_duplicates on public.fixtures;
create trigger fixtures_prevent_provider_duplicates
before insert or update of matchday_id, home_team_name, away_team_name
on public.fixtures
for each row execute function public.prevent_provider_fixture_duplicates();

revoke all on function public.prevent_provider_fixture_duplicates() from public;

commit;
