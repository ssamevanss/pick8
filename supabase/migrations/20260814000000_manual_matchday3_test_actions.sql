begin;

create or replace function public.create_pick8_manual_test_matchday3()
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
  expected_ids text[] := array[
    '990003001', '990003002', '990003003', '990003004', '990003005',
    '990003006', '990003007', '990003008', '990003009', '990003010'
  ];
begin
  if auth.role() <> 'service_role' and not public.is_pick8_admin() then
    raise exception 'Active administrator access is required';
  end if;

  select count(*), (array_agg(id))[1]
  into active_season_count, active_season_id
  from public.seasons
  where is_active = true;
  if active_season_count <> 1 or active_season_id is null then
    raise exception 'Exactly one active Pick8 season is required';
  end if;

  select * into existing_matchday
  from public.matchdays
  where season_id = active_season_id
    and matchday_number = 3;

  if found then
    select count(*) into fixture_count
    from public.fixtures
    where matchday_id = existing_matchday.id;

    if existing_matchday.fixture_sync_mode <> 'manual'
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
      raise exception 'Matchday 3 already exists with unexpected mode or fixture data';
    end if;

    return jsonb_build_object(
      'matchday_id', existing_matchday.id,
      'created', false,
      'fixture_count', fixture_count,
      'locks_at', existing_matchday.locks_at
    );
  end if;

  if exists (
    select 1 from public.fixtures
    where external_fixture_id = any(expected_ids)
  ) then
    raise exception 'One or more Matchday 3 synthetic fixture IDs are already in use';
  end if;

  with source_teams as (
    select fixtures.home_team_id as team_id,
           fixtures.home_team_name as team_name,
           fixtures.home_team_crest_url as crest_url
    from public.fixtures
    join public.matchdays on matchdays.id = fixtures.matchday_id
    where matchdays.season_id = active_season_id
    union all
    select fixtures.away_team_id,
           fixtures.away_team_name,
           fixtures.away_team_crest_url
    from public.fixtures
    join public.matchdays on matchdays.id = fixtures.matchday_id
    where matchdays.season_id = active_season_id
  ), distinct_teams as (
    select distinct on (team_id) team_id, team_name, crest_url
    from source_teams
    where team_id is not null
      and crest_url is not null
      and btrim(crest_url) <> ''
    order by team_id, team_name
  )
  select count(*) into team_count from distinct_teams;

  if team_count < 20 then
    raise exception 'At least 20 existing teams with IDs and crest URLs are required; found %', team_count;
  end if;

  insert into public.matchdays (
    season_id,
    matchday_number,
    fixture_sync_mode,
    status,
    opens_at,
    locks_at,
    updated_at
  ) values (
    active_season_id,
    3,
    'manual',
    'open',
    now(),
    first_kickoff,
    now()
  ) returning id into target_matchday_id;

  with source_teams as (
    select fixtures.home_team_id as team_id,
           fixtures.home_team_name as team_name,
           fixtures.home_team_crest_url as crest_url
    from public.fixtures
    join public.matchdays on matchdays.id = fixtures.matchday_id
    where matchdays.season_id = active_season_id
      and fixtures.home_team_id is not null
      and fixtures.home_team_crest_url is not null
      and btrim(fixtures.home_team_crest_url) <> ''
    union all
    select fixtures.away_team_id,
           fixtures.away_team_name,
           fixtures.away_team_crest_url
    from public.fixtures
    join public.matchdays on matchdays.id = fixtures.matchday_id
    where matchdays.season_id = active_season_id
      and fixtures.away_team_id is not null
      and fixtures.away_team_crest_url is not null
      and btrim(fixtures.away_team_crest_url) <> ''
  ), distinct_teams as (
    select distinct on (team_id) team_id, team_name, crest_url
    from source_teams
    order by team_id, team_name
  ), selected_teams as (
    select * from distinct_teams order by team_id limit 20
  ), ranked_teams as (
    select *, row_number() over (order by team_id) as team_number
    from selected_teams
  ), fixture_pairs as (
    select home.team_number as fixture_number,
           home.team_id as home_team_id,
           home.team_name as home_team_name,
           home.crest_url as home_crest_url,
           away.team_id as away_team_id,
           away.team_name as away_team_name,
           away.crest_url as away_crest_url
    from ranked_teams home
    join ranked_teams away on away.team_number = home.team_number + 10
    where home.team_number between 1 and 10
  )
  insert into public.fixtures (
    matchday_id,
    external_fixture_id,
    home_team_id,
    away_team_id,
    home_team_name,
    away_team_name,
    home_team_crest_url,
    away_team_crest_url,
    kickoff_at,
    status,
    last_synced_at
  )
  select target_matchday_id,
         '990003' || lpad(fixture_number::text, 3, '0'),
         home_team_id,
         away_team_id,
         home_team_name,
         away_team_name,
         home_crest_url,
         away_crest_url,
         first_kickoff + ((fixture_number - 1) * interval '2 hours'),
         'scheduled',
         null
  from fixture_pairs
  order by fixture_number;

  perform public.refresh_pick8_matchday_deadline(target_matchday_id);

  select count(*) into fixture_count
  from public.fixtures
  where matchday_id = target_matchday_id;
  if fixture_count <> 10 then
    raise exception 'Manual Matchday 3 creation failed: expected 10 fixtures, found %', fixture_count;
  end if;

  return jsonb_build_object(
    'matchday_id', target_matchday_id,
    'created', true,
    'fixture_count', fixture_count,
    'locks_at', first_kickoff
  );
end;
$$;

revoke all on function public.create_pick8_manual_test_matchday3() from public;
grant execute on function public.create_pick8_manual_test_matchday3()
to authenticated, service_role;

create or replace function public.finish_pick8_manual_test_matchday3()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_matchday public.matchdays%rowtype;
  fixture_count integer;
  expected_ids text[] := array[
    '990003001', '990003002', '990003003', '990003004', '990003005',
    '990003006', '990003007', '990003008', '990003009', '990003010'
  ];
begin
  if auth.role() <> 'service_role' and not public.is_pick8_admin() then
    raise exception 'Active administrator access is required';
  end if;

  select matchdays.* into target_matchday
  from public.matchdays
  join public.seasons on seasons.id = matchdays.season_id
  where seasons.is_active = true
    and matchdays.matchday_number = 3;

  if not found or target_matchday.fixture_sync_mode <> 'manual' then
    raise exception 'The active season does not have a manual Matchday 3';
  end if;

  select count(*) into fixture_count
  from public.fixtures
  where matchday_id = target_matchday.id;
  if fixture_count <> 10
    or exists (
      select 1 from public.fixtures
      where matchday_id = target_matchday.id
        and external_fixture_id <> all(expected_ids)
    )
  then
    raise exception 'Manual Matchday 3 does not contain the exact synthetic fixture set';
  end if;

  if exists (
    select 1 from public.fixtures
    where matchday_id = target_matchday.id
      and kickoff_at > now()
  ) then
    raise exception 'Manual Matchday 3 cannot be completed before every configured kickoff';
  end if;

  update public.fixtures fixtures
  set status = 'finished',
      home_score = scores.home_score,
      away_score = scores.away_score,
      updated_at = now()
  from (values
    ('990003001', 2, 1),
    ('990003002', 1, 1),
    ('990003003', 3, 2),
    ('990003004', 0, 1),
    ('990003005', 2, 0),
    ('990003006', 1, 3),
    ('990003007', 0, 0),
    ('990003008', 4, 2),
    ('990003009', 1, 0),
    ('990003010', 2, 2)
  ) as scores(external_fixture_id, home_score, away_score)
  where fixtures.matchday_id = target_matchday.id
    and fixtures.external_fixture_id = scores.external_fixture_id;

  return jsonb_build_object(
    'matchday_id', target_matchday.id,
    'season_id', target_matchday.season_id,
    'fixture_count', fixture_count
  );
end;
$$;

revoke all on function public.finish_pick8_manual_test_matchday3() from public;
grant execute on function public.finish_pick8_manual_test_matchday3()
to authenticated, service_role;

commit;
