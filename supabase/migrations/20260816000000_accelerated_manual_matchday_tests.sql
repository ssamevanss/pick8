begin;

alter table public.matchdays
add column if not exists is_accelerated_test boolean not null default false;

alter table public.matchdays
drop constraint if exists matchdays_accelerated_test_manual_check;
alter table public.matchdays
add constraint matchdays_accelerated_test_manual_check
check (not is_accelerated_test or fixture_sync_mode = 'manual');

-- Register the existing tool-created Matchday 3 only when its full synthetic
-- identity is intact. Unexpected/manual matchdays are deliberately untouched.
update public.matchdays matchdays
set is_accelerated_test = true,
    updated_at = now()
where matchdays.matchday_number = 3
  and matchdays.fixture_sync_mode = 'manual'
  and (select count(*) from public.fixtures where fixtures.matchday_id = matchdays.id) = 10
  and not exists (
    select 1 from public.fixtures
    where fixtures.matchday_id = matchdays.id
      and fixtures.external_fixture_id not like '990003___'
  )
  and not exists (
    select 1 from generate_series(1, 10) fixture_number
    where not exists (
      select 1 from public.fixtures
      where fixtures.matchday_id = matchdays.id
        and fixtures.external_fixture_id = '990003' || lpad(fixture_number::text, 3, '0')
    )
  );

update public.matchdays matchdays
set is_accelerated_test = true,
    updated_at = now()
where matchdays.matchday_number = 2
  and matchdays.fixture_sync_mode = 'manual'
  and (select count(*) from public.fixtures where fixtures.matchday_id = matchdays.id) = 10
  and not exists (
    select 1 from generate_series(1, 10) fixture_number
    where not exists (
      select 1 from public.fixtures
      where fixtures.matchday_id = matchdays.id
        and fixtures.external_fixture_id = '990002' || lpad(fixture_number::text, 3, '0')
    )
  );

create or replace function public.create_pick8_accelerated_test_matchday(
  target_matchday_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_season_id uuid;
  active_season_count integer;
  existing_matchday public.matchdays%rowtype;
  target_matchday_id uuid;
  first_kickoff timestamptz := date_trunc('minute', now() + interval '24 hours');
  fixture_count integer;
  team_count integer;
  expected_ids text[];
begin
  if auth.role() <> 'service_role' and not public.is_pick8_admin() then
    raise exception 'Active administrator access is required';
  end if;
  if target_matchday_number < 3 or target_matchday_number > 99 then
    raise exception 'Accelerated test matchday number is outside the supported range';
  end if;

  select array_agg('990' || lpad(target_matchday_number::text, 3, '0') || lpad(fixture_number::text, 3, '0') order by fixture_number)
  into expected_ids
  from generate_series(1, 10) fixture_number;

  select count(*), (array_agg(id))[1]
  into active_season_count, active_season_id
  from public.seasons
  where is_active = true;
  if active_season_count <> 1 or active_season_id is null then
    raise exception 'Exactly one active Pick8 season is required';
  end if;

  if target_matchday_number > 3 and not exists (
    select 1 from public.matchdays
    where season_id = active_season_id
      and matchday_number = target_matchday_number - 1
      and status = 'completed'
      and is_accelerated_test = true
  ) then
    raise exception 'The previous accelerated test matchday must be completed first';
  end if;

  select * into existing_matchday
  from public.matchdays
  where season_id = active_season_id
    and matchday_number = target_matchday_number;

  if found then
    select count(*) into fixture_count from public.fixtures where matchday_id = existing_matchday.id;
    if existing_matchday.fixture_sync_mode <> 'manual'
      or not existing_matchday.is_accelerated_test
      or fixture_count <> 10
      or exists (
        select 1 from public.fixtures
        where matchday_id = existing_matchday.id
          and external_fixture_id <> all(expected_ids)
      )
      or exists (
        select 1 from unnest(expected_ids) expected(external_fixture_id)
        where not exists (
          select 1 from public.fixtures
          where matchday_id = existing_matchday.id
            and fixtures.external_fixture_id = expected.external_fixture_id
        )
      )
    then
      raise exception 'Matchday % already exists with unexpected mode or fixture data', target_matchday_number;
    end if;
    return jsonb_build_object(
      'matchday_id', existing_matchday.id,
      'season_id', existing_matchday.season_id,
      'matchday_number', existing_matchday.matchday_number,
      'created', false,
      'fixture_count', fixture_count,
      'locks_at', existing_matchday.locks_at
    );
  end if;

  if exists (select 1 from public.fixtures where external_fixture_id = any(expected_ids)) then
    raise exception 'One or more Matchday % synthetic fixture IDs are already in use', target_matchday_number;
  end if;

  with source_teams as (
    select fixtures.home_team_id as team_id, fixtures.home_team_name as team_name, fixtures.home_team_crest_url as crest_url
    from public.fixtures join public.matchdays on matchdays.id = fixtures.matchday_id
    where matchdays.season_id = active_season_id
    union all
    select fixtures.away_team_id, fixtures.away_team_name, fixtures.away_team_crest_url
    from public.fixtures join public.matchdays on matchdays.id = fixtures.matchday_id
    where matchdays.season_id = active_season_id
  ), distinct_teams as (
    select distinct on (team_id) team_id, team_name, crest_url
    from source_teams
    where team_id is not null and crest_url is not null and btrim(crest_url) <> ''
    order by team_id, team_name
  )
  select count(*) into team_count from distinct_teams;
  if team_count < 20 then
    raise exception 'At least 20 existing teams with IDs and crest URLs are required; found %', team_count;
  end if;

  insert into public.matchdays (
    season_id, matchday_number, fixture_sync_mode, is_accelerated_test,
    status, opens_at, locks_at, updated_at
  ) values (
    active_season_id, target_matchday_number, 'manual', true,
    'open', now(), first_kickoff, now()
  ) returning id into target_matchday_id;

  with source_teams as (
    select fixtures.home_team_id as team_id, fixtures.home_team_name as team_name, fixtures.home_team_crest_url as crest_url
    from public.fixtures join public.matchdays on matchdays.id = fixtures.matchday_id
    where matchdays.season_id = active_season_id
      and fixtures.home_team_id is not null
      and fixtures.home_team_crest_url is not null
      and btrim(fixtures.home_team_crest_url) <> ''
    union all
    select fixtures.away_team_id, fixtures.away_team_name, fixtures.away_team_crest_url
    from public.fixtures join public.matchdays on matchdays.id = fixtures.matchday_id
    where matchdays.season_id = active_season_id
      and fixtures.away_team_id is not null
      and fixtures.away_team_crest_url is not null
      and btrim(fixtures.away_team_crest_url) <> ''
  ), distinct_teams as (
    select distinct on (team_id) team_id, team_name, crest_url
    from source_teams order by team_id, team_name
  ), selected_teams as (
    select * from distinct_teams order by team_id limit 20
  ), ranked_teams as (
    select *, row_number() over (order by team_id) as team_number from selected_teams
  ), fixture_pairs as (
    select home.team_number as fixture_number,
           home.team_id as home_team_id, home.team_name as home_team_name, home.crest_url as home_crest_url,
           away.team_id as away_team_id, away.team_name as away_team_name, away.crest_url as away_crest_url
    from ranked_teams home
    join ranked_teams away on away.team_number = home.team_number + 10
    where home.team_number between 1 and 10
  )
  insert into public.fixtures (
    matchday_id, external_fixture_id, home_team_id, away_team_id,
    home_team_name, away_team_name, home_team_crest_url, away_team_crest_url,
    kickoff_at, status, last_synced_at
  )
  select target_matchday_id,
         '990' || lpad(target_matchday_number::text, 3, '0') || lpad(fixture_number::text, 3, '0'),
         home_team_id, away_team_id, home_team_name, away_team_name, home_crest_url, away_crest_url,
         first_kickoff + ((fixture_number - 1) * interval '2 hours'), 'scheduled', null
  from fixture_pairs order by fixture_number;

  perform public.refresh_pick8_matchday_deadline(target_matchday_id);
  select count(*) into fixture_count from public.fixtures where matchday_id = target_matchday_id;
  if fixture_count <> 10 then
    raise exception 'Manual Matchday % creation failed: expected 10 fixtures, found %', target_matchday_number, fixture_count;
  end if;

  return jsonb_build_object(
    'matchday_id', target_matchday_id,
    'season_id', active_season_id,
    'matchday_number', target_matchday_number,
    'created', true,
    'fixture_count', fixture_count,
    'locks_at', first_kickoff
  );
end;
$$;

revoke all on function public.create_pick8_accelerated_test_matchday(integer) from public;
grant execute on function public.create_pick8_accelerated_test_matchday(integer)
to authenticated, service_role;

create or replace function public.prepare_pick8_accelerated_test_completion(
  target_matchday_number integer,
  confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_matchday public.matchdays%rowtype;
  fixture_count integer;
  updated_count integer;
  expected_ids text[];
begin
  if auth.role() <> 'service_role' and not public.is_pick8_admin() then
    raise exception 'Active administrator access is required';
  end if;
  if confirmed is not true then
    raise exception 'Explicit accelerated-test confirmation is required';
  end if;

  select array_agg('990' || lpad(target_matchday_number::text, 3, '0') || lpad(fixture_number::text, 3, '0') order by fixture_number)
  into expected_ids
  from generate_series(1, 10) fixture_number;

  select matchdays.* into target_matchday
  from public.matchdays
  join public.seasons on seasons.id = matchdays.season_id
  where seasons.is_active = true
    and matchdays.matchday_number = target_matchday_number;

  if not found
    or target_matchday.fixture_sync_mode <> 'manual'
    or not target_matchday.is_accelerated_test
  then
    raise exception 'The selected matchday is not an accelerated manual test matchday';
  end if;
  if target_matchday.status = 'completed' then
    raise exception 'The accelerated test matchday is already completed';
  end if;

  select count(*) into fixture_count from public.fixtures where matchday_id = target_matchday.id;
  if fixture_count <> 10
    or exists (
      select 1 from public.fixtures
      where matchday_id = target_matchday.id
        and external_fixture_id <> all(expected_ids)
    )
    or exists (
      select 1 from unnest(expected_ids) expected(external_fixture_id)
      where not exists (
        select 1 from public.fixtures
        where matchday_id = target_matchday.id
          and fixtures.external_fixture_id = expected.external_fixture_id
      )
    )
  then
    raise exception 'The accelerated test matchday does not contain its exact synthetic fixture set';
  end if;

  update public.fixtures
  set status = 'finished',
      home_score = case right(external_fixture_id, 3)::integer
        when 1 then 2 when 2 then 1 when 3 then 3 when 4 then 0 when 5 then 2
        when 6 then 1 when 7 then 0 when 8 then 4 when 9 then 1 when 10 then 2 end,
      away_score = case right(external_fixture_id, 3)::integer
        when 1 then 1 when 2 then 1 when 3 then 2 when 4 then 1 when 5 then 0
        when 6 then 3 when 7 then 0 when 8 then 2 when 9 then 0 when 10 then 2 end,
      updated_at = now()
  where matchday_id = target_matchday.id
    and external_fixture_id = any(expected_ids);
  get diagnostics updated_count = row_count;
  if updated_count <> 10 then
    raise exception 'Expected to finalize 10 synthetic fixtures, updated %', updated_count;
  end if;

  return jsonb_build_object(
    'matchday_id', target_matchday.id,
    'season_id', target_matchday.season_id,
    'matchday_number', target_matchday.matchday_number,
    'fixture_count', fixture_count,
    'accelerated', true
  );
end;
$$;

revoke all on function public.prepare_pick8_accelerated_test_completion(integer, boolean) from public;
grant execute on function public.prepare_pick8_accelerated_test_completion(integer, boolean)
to authenticated, service_role;

revoke execute on function public.create_pick8_manual_test_matchday3() from authenticated, service_role;
revoke execute on function public.finish_pick8_manual_test_matchday3() from authenticated, service_role;

commit;
