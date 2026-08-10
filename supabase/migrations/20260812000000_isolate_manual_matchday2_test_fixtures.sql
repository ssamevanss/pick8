begin;

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
  selected_count integer;
begin
  if not exists (
    select 1 from public.matchdays
    where id = target_matchday_id
      and matchday_number = 2
      and fixture_sync_mode = 'manual'
  ) then
    raise exception 'Matchday 2 cleanup aborted: target is missing or not manual';
  end if;

  if not exists (
    select 1 from public.entries
    where id = target_entry_id
      and matchday_id = target_matchday_id
      and submitted_at is not null
      and total_goals_prediction = 25
  ) then
    raise exception 'Matchday 2 cleanup aborted: submitted test entry does not match expectations';
  end if;

  select count(*) into selected_count
  from public.entry_selections selections
  join public.fixtures on fixtures.id = selections.fixture_id
  where selections.entry_id = target_entry_id
    and fixtures.matchday_id = target_matchday_id
    and fixtures.external_fixture_id = any(synthetic_ids);

  if selected_count <> 7 or exists (
    select 1
    from public.entry_selections selections
    join public.fixtures on fixtures.id = selections.fixture_id
    where selections.entry_id = target_entry_id
      and fixtures.external_fixture_id <> all(synthetic_ids)
  ) then
    raise exception 'Matchday 2 cleanup aborted: submitted selections are not exactly seven synthetic fixtures';
  end if;

  if (
    select count(*) from public.fixtures
    where matchday_id = target_matchday_id
      and external_fixture_id = any(provider_ids)
  ) <> 10 then
    raise exception 'Matchday 2 cleanup aborted: provider fixture set does not match the audited ten rows';
  end if;

  if exists (
    select 1
    from public.entry_selections selections
    join public.fixtures on fixtures.id = selections.fixture_id
    where fixtures.matchday_id = target_matchday_id
      and fixtures.external_fixture_id = any(provider_ids)
  ) then
    raise exception 'Matchday 2 cleanup aborted: a provider fixture is referenced by an entry';
  end if;

  delete from public.fixtures
  where matchday_id = target_matchday_id
    and external_fixture_id = any(provider_ids);

  if (
    select count(*) from public.fixtures
    where matchday_id = target_matchday_id
      and external_fixture_id = any(synthetic_ids)
  ) <> 10 or (
    select count(*) from public.fixtures where matchday_id = target_matchday_id
  ) <> 10 then
    raise exception 'Matchday 2 cleanup verification failed: expected exactly ten synthetic fixtures';
  end if;

  if (
    select count(*) from public.entry_selections where entry_id = target_entry_id
  ) <> 7 then
    raise exception 'Matchday 2 cleanup verification failed: submitted selections changed';
  end if;
end;
$$;

commit;
