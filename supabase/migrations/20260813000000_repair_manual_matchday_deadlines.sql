begin;

create or replace function public.protect_manual_matchday_from_provider_fixtures()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.last_synced_at is not null and exists (
    select 1
    from public.matchdays
    where matchdays.id = new.matchday_id
      and matchdays.fixture_sync_mode = 'manual'
  ) then
    raise exception 'Provider-synced fixtures cannot be written to a manual matchday';
  end if;
  return new;
end;
$$;

drop trigger if exists fixtures_protect_manual_matchday_from_provider on public.fixtures;
create trigger fixtures_protect_manual_matchday_from_provider
before insert or update of matchday_id, last_synced_at
on public.fixtures
for each row execute function public.protect_manual_matchday_from_provider_fixtures();

revoke all on function public.protect_manual_matchday_from_provider_fixtures() from public;

create or replace function public.refresh_pick8_matchday_deadline(check_matchday_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_kickoff timestamptz;
begin
  select min(fixtures.kickoff_at)
  into first_kickoff
  from public.fixtures
  where fixtures.matchday_id = check_matchday_id;

  update public.matchdays
  set locks_at = first_kickoff,
      updated_at = case
        when locks_at is distinct from first_kickoff then now()
        else updated_at
      end
  where id = check_matchday_id
    and locks_at is distinct from first_kickoff;
end;
$$;

revoke all on function public.refresh_pick8_matchday_deadline(uuid) from public;

create or replace function public.sync_pick8_matchday_deadline_from_fixtures()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_pick8_matchday_deadline(old.matchday_id);
    return old;
  end if;

  perform public.refresh_pick8_matchday_deadline(new.matchday_id);
  if tg_op = 'UPDATE' and old.matchday_id is distinct from new.matchday_id then
    perform public.refresh_pick8_matchday_deadline(old.matchday_id);
  end if;
  return new;
end;
$$;

drop trigger if exists fixtures_sync_matchday_deadline on public.fixtures;
create trigger fixtures_sync_matchday_deadline
after insert or delete or update of matchday_id, kickoff_at
on public.fixtures
for each row execute function public.sync_pick8_matchday_deadline_from_fixtures();

revoke all on function public.sync_pick8_matchday_deadline_from_fixtures() from public;

do $$
declare
  target_matchday_id uuid := '5e9c84a0-76f3-4177-83ad-5c9061691a65';
  target_entry_id uuid := '43142dc9-d1ce-4190-8dc9-1a69720d0c52';
  synthetic_ids text[] := array[
    '990002001', '990002002', '990002003', '990002004', '990002005',
    '990002006', '990002007', '990002008', '990002009', '990002010'
  ];
  provider_ids text[] := array[
    '560552', '560553', '560554', '560555', '560556',
    '560557', '560558', '560559', '560560', '560561'
  ];
  provider_count integer;
begin
  if not exists (
    select 1 from public.matchdays
    where id = target_matchday_id
      and matchday_number = 2
      and fixture_sync_mode = 'manual'
  ) then
    raise exception 'Matchday 2 repair aborted: target is missing or not manual';
  end if;

  if not exists (
    select 1 from public.entries
    where id = target_entry_id
      and matchday_id = target_matchday_id
      and submitted_at is not null
      and total_goals_prediction = 25
  ) or (
    select count(*) from public.entry_selections
    where entry_id = target_entry_id
  ) <> 7 then
    raise exception 'Matchday 2 repair aborted: submitted entry does not match the audited state';
  end if;

  if exists (
    select 1
    from public.entry_selections selections
    join public.fixtures on fixtures.id = selections.fixture_id
    where selections.entry_id = target_entry_id
      and (
        fixtures.matchday_id <> target_matchday_id
        or fixtures.external_fixture_id <> all(synthetic_ids)
      )
  ) then
    raise exception 'Matchday 2 repair aborted: a submitted selection is not on the synthetic set';
  end if;

  if exists (
    select 1 from public.fixtures
    where matchday_id = target_matchday_id
      and external_fixture_id <> all(synthetic_ids)
      and external_fixture_id <> all(provider_ids)
  ) then
    raise exception 'Matchday 2 repair aborted: an unexpected fixture is present';
  end if;

  select count(*) into provider_count
  from public.fixtures
  where matchday_id = target_matchday_id
    and external_fixture_id = any(provider_ids);

  if provider_count not in (0, 10) then
    raise exception 'Matchday 2 repair aborted: expected zero or all ten provider fixtures, found %', provider_count;
  end if;

  if exists (
    select 1
    from public.entry_selections selections
    join public.fixtures on fixtures.id = selections.fixture_id
    where fixtures.matchday_id = target_matchday_id
      and fixtures.external_fixture_id = any(provider_ids)
  ) then
    raise exception 'Matchday 2 repair aborted: a provider fixture is referenced by an entry';
  end if;

  delete from public.fixtures
  where matchday_id = target_matchday_id
    and external_fixture_id = any(provider_ids);

  perform public.refresh_pick8_matchday_deadline(target_matchday_id);

  if (
    select count(*) from public.fixtures
    where matchday_id = target_matchday_id
      and external_fixture_id = any(synthetic_ids)
  ) <> 10 or (
    select count(*) from public.fixtures
    where matchday_id = target_matchday_id
  ) <> 10 then
    raise exception 'Matchday 2 repair failed: expected exactly ten synthetic fixtures';
  end if;

  if (
    select locks_at from public.matchdays where id = target_matchday_id
  ) is distinct from timestamptz '2026-08-10 09:00:00+00' then
    raise exception 'Matchday 2 repair failed: deadline was not aligned to first kickoff';
  end if;
end;
$$;

-- Backfill every existing matchday so provider and manual deadlines both use
-- the configured first fixture kickoff. opens_at remains the explicit time at
-- which the matchday was made available; it is not a deadline override.
do $$
declare
  matchday_row record;
begin
  for matchday_row in select id from public.matchdays loop
    perform public.refresh_pick8_matchday_deadline(matchday_row.id);
  end loop;
end;
$$;

commit;
