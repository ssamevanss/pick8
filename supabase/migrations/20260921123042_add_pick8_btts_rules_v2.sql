begin;

alter table public.matchdays
  add column pick8_rules_version smallint not null default 1,
  add constraint matchdays_pick8_rules_version_check
    check (pick8_rules_version in (1, 2));

-- Applying version 2 to an already-submitted entry would make that entry
-- incomplete. Abort the rollout instead of silently invalidating player data.
do $$
begin
  if exists (
    select 1
    from public.entries
    join public.matchdays on matchdays.id = entries.matchday_id
    where matchdays.matchday_number >= 6
      and entries.submitted_at is not null
  ) then
    raise exception 'BTTS rollout aborted: Matchday 6 or later already has submitted Pick8 entries';
  end if;
end;
$$;

update public.matchdays
set pick8_rules_version = case when matchday_number >= 6 then 2 else 1 end;

alter table public.matchdays
  alter column pick8_rules_version set default 2;

create function public.pick8_categories_for_rules_version(check_rules_version smallint)
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select case check_rules_version
    when 1 then array[
      'home_win', 'away_win', 'draw', 'team_win', 'team_lose',
      'team_score', 'clean_sheet'
    ]::text[]
    when 2 then array[
      'home_win', 'away_win', 'draw', 'team_win', 'team_lose',
      'team_score', 'clean_sheet', 'btts'
    ]::text[]
    else array[]::text[]
  end;
$$;

revoke all on function public.pick8_categories_for_rules_version(smallint)
from public, anon, authenticated;
grant execute on function public.pick8_categories_for_rules_version(smallint)
to service_role;

alter table public.entry_selections
  drop constraint entry_selections_category_check,
  drop constraint entry_selections_category_side_check;

alter table public.entry_selections
  add constraint entry_selections_category_check
    check (
      category in (
        'home_win', 'away_win', 'draw', 'team_win', 'team_lose',
        'team_score', 'clean_sheet', 'btts'
      )
    ),
  add constraint entry_selections_category_side_check
    check (
      (category = 'home_win' and selected_team_side = 'home')
      or (category = 'away_win' and selected_team_side = 'away')
      or (category in ('draw', 'btts') and selected_team_side is null)
      or (
        category in ('team_win', 'team_lose', 'team_score', 'clean_sheet')
        and selected_team_side in ('home', 'away')
      )
    );

create or replace function public.validate_entry_selection_matchday()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_matchday_id uuid;
  fixture_matchday_id uuid;
  rules_version smallint;
begin
  select entries.matchday_id, matchdays.pick8_rules_version
  into entry_matchday_id, rules_version
  from public.entries
  join public.matchdays on matchdays.id = entries.matchday_id
  where entries.id = new.entry_id;

  select matchday_id
  into fixture_matchday_id
  from public.fixtures
  where id = new.fixture_id;

  if entry_matchday_id is null
    or fixture_matchday_id is null
    or entry_matchday_id <> fixture_matchday_id
  then
    raise exception 'Selection fixture must belong to the entry matchday';
  end if;

  if not (new.category = any(public.pick8_categories_for_rules_version(rules_version))) then
    raise exception using
      errcode = '23514',
      message = 'Selection category is not available for this Matchday rules version';
  end if;

  return new;
end;
$$;

drop trigger entry_selections_validate_matchday on public.entry_selections;
create trigger entry_selections_validate_matchday
before insert or update of entry_id, fixture_id, category
on public.entry_selections
for each row execute function public.validate_entry_selection_matchday();

create or replace function public.require_complete_entry_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fixture_selection_count integer;
  fixture_category_count integer;
  required_categories text[];
begin
  if new.submitted_at is null then
    return new;
  end if;

  select public.pick8_categories_for_rules_version(matchdays.pick8_rules_version)
  into required_categories
  from public.matchdays
  where matchdays.id = new.matchday_id;

  select count(*), count(distinct category)
  into fixture_selection_count, fixture_category_count
  from public.entry_selections
  where entry_id = new.id
    and category = any(required_categories);

  if new.total_goals_prediction is null
    or fixture_selection_count <> cardinality(required_categories)
    or fixture_category_count <> cardinality(required_categories)
  then
    raise exception using
      errcode = '23514',
      message = 'Entry must have every required fixture selection and Total Goals before submission';
  end if;

  return new;
end;
$$;

-- This older submission guard is still deployed alongside the newer complete
-- entry guard. Keep it rules-version aware so it cannot reject Version 2.
create or replace function public.validate_pick8_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selection_count integer;
  required_count integer;
begin
  if new.submitted_at is not null and old.submitted_at is null then
    select cardinality(
      public.pick8_categories_for_rules_version(matchdays.pick8_rules_version)
    )
    into required_count
    from public.matchdays
    where matchdays.id = new.matchday_id;

    select count(*)
    into selection_count
    from public.entry_selections
    where entry_id = new.id;

    if selection_count <> required_count then
      raise exception using
        errcode = '23514',
        message = format(
          'Entry must contain all %s fixture selections before submission. Current count: %s.',
          required_count,
          selection_count
        );
    end if;

    if new.total_goals_prediction is null then
      raise exception using
        errcode = '23514',
        message = 'Entry must include a Total Goals prediction before submission.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.require_valid_submitted_entry_selections()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_entry_id uuid;
  selection_count integer;
  category_count integer;
  required_categories text[];
begin
  target_entry_id := case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;

  select public.pick8_categories_for_rules_version(matchdays.pick8_rules_version)
  into required_categories
  from public.entries
  join public.matchdays on matchdays.id = entries.matchday_id
  where entries.id = target_entry_id
    and entries.submitted_at is not null;

  if required_categories is null then
    return null;
  end if;

  select count(*), count(distinct category)
  into selection_count, category_count
  from public.entry_selections
  where entry_id = target_entry_id
    and category = any(required_categories);

  if selection_count <> cardinality(required_categories)
    or category_count <> cardinality(required_categories)
  then
    raise exception using
      errcode = '23514',
      message = 'Submitted entry selections must contain each required Pick8 category exactly once';
  end if;

  return null;
end;
$$;

create or replace function public.save_pick8_entry(
  check_matchday_id uuid,
  check_intent text,
  check_total_goals integer,
  check_selections jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  matchday_status text;
  rules_version smallint;
  required_categories text[];
  required_count integer;
  first_kickoff timestamptz;
  target_entry public.entries%rowtype;
  supplied_count integer;
  category_count integer;
  fixture_count integer;
  valid_category_count integer;
  valid_fixture_count integer;
  changed_count integer;
  processed_at timestamptz;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if check_intent not in ('draft', 'submit', 'save_changes') then
    raise exception using errcode = '22023', message = 'Invalid Pick8 save intent';
  end if;
  if jsonb_typeof(check_selections) <> 'array' then
    raise exception using errcode = '22023', message = 'Selections must be an array';
  end if;

  select matchdays.status, matchdays.pick8_rules_version
  into matchday_status, rules_version
  from public.matchdays
  join public.seasons on seasons.id = matchdays.season_id
  where matchdays.id = check_matchday_id
    and seasons.is_active = true
  for update of matchdays;

  required_categories := public.pick8_categories_for_rules_version(rules_version);
  required_count := cardinality(required_categories);

  select min(fixtures.kickoff_at)
  into first_kickoff
  from public.fixtures
  where fixtures.matchday_id = check_matchday_id;

  processed_at := clock_timestamp();
  if matchday_status is null
    or matchday_status = 'completed'
    or first_kickoff is null
    or processed_at >= first_kickoff
  then
    raise exception using
      errcode = '42501',
      message = 'Matchday has locked at the first fixture kickoff';
  end if;
  if not public.can_participate_in_pick8(actor_id) then
    raise exception using errcode = '42501', message = 'Pick8 participation is not active';
  end if;

  with target as (
    select * from jsonb_to_recordset(check_selections) as selection(
      category text, fixture_id uuid, selected_team_side text
    )
  )
  select count(*), count(distinct category), count(distinct fixture_id),
    count(*) filter (where category = any(required_categories))
  into supplied_count, category_count, fixture_count, valid_category_count
  from target;

  if supplied_count > required_count or supplied_count <> fixture_count then
    raise exception using errcode = '23514', message = 'Pick8 fixture selections must be unique';
  end if;
  if valid_category_count <> supplied_count then
    raise exception using errcode = '23514', message = 'A selection category is not available for this Matchday';
  end if;
  if check_intent in ('submit', 'save_changes') and (
    check_total_goals is null
    or check_total_goals < 0
    or check_total_goals > 100
    or supplied_count <> required_count
    or category_count <> required_count
  ) then
    raise exception using
      errcode = '23514',
      message = 'Entry must have every required fixture selection and Total Goals before submission';
  end if;

  with target as (
    select * from jsonb_to_recordset(check_selections) as selection(
      category text, fixture_id uuid, selected_team_side text
    )
  )
  select count(*) into valid_fixture_count
  from target
  join public.fixtures
    on fixtures.id = target.fixture_id
   and fixtures.matchday_id = check_matchday_id;

  if valid_fixture_count <> supplied_count then
    raise exception using errcode = '23514', message = 'A selection fixture is not in this Matchday';
  end if;

  select entries.* into target_entry
  from public.entries
  where entries.user_id = actor_id
    and entries.matchday_id = check_matchday_id
  for update;

  if check_intent = 'save_changes' and target_entry.id is null then
    raise exception using errcode = '23514', message = 'There is no submitted entry to update';
  end if;
  if check_intent = 'save_changes' and target_entry.submitted_at is null then
    raise exception using errcode = '23514', message = 'There is no submitted entry to update';
  end if;
  if check_intent = 'draft' and target_entry.submitted_at is not null then
    raise exception using errcode = '23514', message = 'A submitted entry cannot be changed back to a draft';
  end if;
  if check_intent = 'submit' and target_entry.submitted_at is not null then
    raise exception using errcode = '23514', message = 'This entry is already submitted';
  end if;

  if target_entry.id is null then
    insert into public.entries (
      user_id, matchday_id, total_goals_prediction, submitted_at, updated_at
    ) values (
      actor_id, check_matchday_id, check_total_goals, null, processed_at
    ) returning * into target_entry;
  end if;

  if check_intent = 'save_changes' then
    with target as (
      select * from jsonb_to_recordset(check_selections) as selection(
        category text, fixture_id uuid, selected_team_side text
      )
    )
    update public.entry_selections
    set fixture_id = target.fixture_id,
        selected_team_side = target.selected_team_side,
        updated_at = processed_at
    from target
    where entry_selections.entry_id = target_entry.id
      and entry_selections.category = target.category;

    get diagnostics changed_count = row_count;
    if changed_count <> required_count then
      raise exception using errcode = '23514', message = 'Submitted selection update was incomplete';
    end if;
  else
    delete from public.entry_selections
    where entry_selections.entry_id = target_entry.id;

    insert into public.entry_selections (
      entry_id, category, fixture_id, selected_team_side, updated_at
    )
    select target_entry.id, selection.category, selection.fixture_id,
      selection.selected_team_side, processed_at
    from jsonb_to_recordset(check_selections) as selection(
      category text, fixture_id uuid, selected_team_side text
    );
  end if;

  update public.entries
  set total_goals_prediction = check_total_goals,
      submitted_at = case when check_intent = 'submit' then processed_at else target_entry.submitted_at end,
      updated_at = processed_at
  where entries.id = target_entry.id
  returning * into target_entry;

  if clock_timestamp() >= first_kickoff then
    raise exception using errcode = '42501', message = 'Matchday has locked at the first fixture kickoff';
  end if;

  return jsonb_build_object('entry_id', target_entry.id, 'submitted_at', target_entry.submitted_at);
end;
$$;

create or replace function public.replace_submitted_pick8_selections(
  check_entry_id uuid,
  check_selections jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_matchday_id uuid;
  required_categories text[];
  required_count integer;
  supplied_count integer;
  category_count integer;
  fixture_count integer;
  valid_category_count integer;
  valid_fixture_count integer;
  changed_count integer;
  first_kickoff timestamptz;
begin
  select entries.matchday_id,
    public.pick8_categories_for_rules_version(matchdays.pick8_rules_version)
  into target_matchday_id, required_categories
  from public.entries
  join public.matchdays on matchdays.id = entries.matchday_id
  where entries.id = check_entry_id
    and entries.user_id = auth.uid()
    and entries.submitted_at is not null
  for update of entries;

  required_count := cardinality(required_categories);

  select min(fixtures.kickoff_at) into first_kickoff
  from public.fixtures where fixtures.matchday_id = target_matchday_id;

  if target_matchday_id is null
    or not public.can_participate_in_pick8(auth.uid())
    or first_kickoff is null
    or clock_timestamp() >= first_kickoff
  then
    raise exception using errcode = '42501', message = 'Matchday has locked at the first fixture kickoff';
  end if;
  if jsonb_typeof(check_selections) <> 'array' then
    raise exception using errcode = '22023', message = 'Selections must be an array';
  end if;

  with target as (
    select * from jsonb_to_recordset(check_selections) as selection(
      category text, fixture_id uuid, selected_team_side text
    )
  )
  select count(*), count(distinct category), count(distinct fixture_id),
    count(*) filter (where category = any(required_categories))
  into supplied_count, category_count, fixture_count, valid_category_count
  from target;

  if supplied_count <> required_count
    or category_count <> required_count
    or fixture_count <> required_count
    or valid_category_count <> required_count
  then
    raise exception using errcode = '23514', message = 'Edited categories and fixtures must match this Matchday rules version';
  end if;

  with target as (
    select * from jsonb_to_recordset(check_selections) as selection(
      category text, fixture_id uuid, selected_team_side text
    )
  )
  select count(*) into valid_fixture_count
  from target
  join public.fixtures
    on fixtures.id = target.fixture_id
   and fixtures.matchday_id = target_matchday_id;

  if valid_fixture_count <> required_count then
    raise exception using errcode = '23514', message = 'A selection fixture is not in this Matchday';
  end if;

  with target as (
    select * from jsonb_to_recordset(check_selections) as selection(
      category text, fixture_id uuid, selected_team_side text
    )
  )
  update public.entry_selections
  set fixture_id = target.fixture_id,
      selected_team_side = target.selected_team_side,
      updated_at = clock_timestamp()
  from target
  where entry_selections.entry_id = check_entry_id
    and entry_selections.category = target.category;

  get diagnostics changed_count = row_count;
  if changed_count <> required_count or clock_timestamp() >= first_kickoff then
    raise exception using errcode = '42501', message = 'Matchday has locked at the first fixture kickoff';
  end if;
end;
$$;

create or replace function public.score_pick8_matchday(
  check_season_id uuid,
  check_matchday_id uuid,
  check_scoring_revision bigint,
  allow_accelerated_test_completion boolean default false
)
returns jsonb language plpgsql volatile security invoker
set search_path = ''
set lock_timeout = '500ms'
set statement_timeout = '5s'
as $$
declare
  snapshot jsonb;
  md public.matchdays%rowtype;
  scoring_time timestamptz := clock_timestamp();
  final_ready boolean;
  has_future boolean;
  has_started boolean;
  goal_total integer;
  lifecycle text;
  selection_results jsonb;
  selection_count integer;
  scored_count integer;
  void_count integer;
  entry_count integer;
  all_entry_count integer;
  selections_changed integer;
  entries_changed integer;
  result jsonb;
begin
  if current_user <> 'service_role' then
    raise exception 'Scoring requires service_role' using errcode = '42501';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('pick8-scoring:' || check_matchday_id::text, 0)) then
    raise exception 'Matchday scoring is already running' using errcode = '55P03';
  end if;

  select jsonb_build_object(
    'matchday', to_jsonb(m),
    'fixtures', coalesce((select jsonb_agg(to_jsonb(f)) from public.fixtures f where f.matchday_id = m.id), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(to_jsonb(e)) from public.entries e where e.matchday_id = m.id), '[]'::jsonb),
    'selections', coalesce((select jsonb_agg(to_jsonb(s)) from public.entry_selections s
      join public.entries e on e.id = s.entry_id where e.matchday_id = m.id and e.submitted_at is not null), '[]'::jsonb)
  ) into snapshot
  from public.matchdays m where m.id = check_matchday_id and m.season_id = check_season_id;
  if snapshot is null then raise exception 'The selected matchday does not belong to that season.'; end if;
  select * into md from jsonb_populate_record(null::public.matchdays, snapshot->'matchday');
  if md.scoring_revision is distinct from check_scoring_revision then
    raise exception 'Scoring inputs changed; retry required' using errcode = '40001';
  end if;
  if not md.scoring_pending and md.scored_revision = check_scoring_revision and md.scoring_result is not null then
    return md.scoring_result || jsonb_build_object('reused', true, 'selectionRowsChanged', 0, 'entryRowsChanged', 0);
  end if;
  if not md.scoring_pending then raise exception 'Scoring pending must be persisted before scoring'; end if;

  -- A finished fixture is terminal only when both final scores required by every
  -- fixture category are present. Postponed/cancelled fixtures remain void.
  select count(*) > 0 and coalesce(bool_and(
      f.status in ('finished','postponed','cancelled')
      and (f.status <> 'finished' or (f.home_score is not null and f.away_score is not null))
    ), false),
    coalesce(bool_or(f.kickoff_at > scoring_time), false),
    coalesce(bool_or(f.status in ('in_play','paused','finished') or f.kickoff_at <= scoring_time), false),
    coalesce(sum(case when f.status = 'finished' and f.home_score is not null and f.away_score is not null
      then f.home_score + f.away_score else 0 end), 0)
  into final_ready, has_future, has_started, goal_total
  from jsonb_populate_recordset(null::public.fixtures, snapshot->'fixtures') f;
  if final_ready and has_future and not (coalesce(allow_accelerated_test_completion, false)
    and md.fixture_sync_mode = 'manual' and md.is_accelerated_test) then
    raise exception 'A matchday cannot be completed before every configured kickoff.';
  end if;
  lifecycle := case when final_ready then 'completed' when has_started then 'scoring'
    when md.status = 'upcoming' then 'upcoming' else 'open' end;

  if exists (select 1 from jsonb_populate_recordset(null::public.entry_selections, snapshot->'selections') s
    left join jsonb_populate_recordset(null::public.fixtures, snapshot->'fixtures') f on f.id = s.fixture_id
    where f.id is null or (f.status = 'finished' and f.home_score is not null and f.away_score is not null
      and s.category in ('team_win','team_lose','team_score','clean_sheet')
      and (s.selected_team_side is null or s.selected_team_side not in ('home','away')))) then
    raise exception 'Selection fixture missing or selected team invalid';
  end if;

  with inputs as (
    select s.id, s.entry_id, s.category, f.status,
      f.status = 'finished' and f.home_score is not null and f.away_score is not null as scoreable,
      f.home_score, f.away_score,
      case when s.category = 'home_win' or (s.category <> 'away_win' and s.selected_team_side = 'home')
        then f.home_score else f.away_score end as goals_for,
      case when s.category = 'home_win' or (s.category <> 'away_win' and s.selected_team_side = 'home')
        then f.away_score else f.home_score end as goals_against
    from jsonb_populate_recordset(null::public.entry_selections, snapshot->'selections') s
    join jsonb_populate_recordset(null::public.fixtures, snapshot->'fixtures') f on f.id = s.fixture_id
  ), outcomes as (
    select *, case when not scoreable then null
      when category in ('home_win','away_win','team_win') then goals_for > goals_against
      when category = 'draw' then home_score = away_score
      when category = 'team_lose' then goals_for < goals_against
      when category = 'team_score' then goals_for > 0
      when category = 'clean_sheet' then goals_against = 0
      when category = 'btts' then home_score > 0 and away_score > 0 end as correct
    from inputs
  ), points as (
    select *, case when not scoreable then null
      when category in ('home_win','away_win') then
        case when goals_for > goals_against then (case when category = 'home_win' then 5 else 10 end) + goals_for - goals_against
          when goals_for < goals_against then -5 * (goals_against - goals_for) else 0 end
      when category = 'draw' then case when correct then 15 + home_score else 0 end
      else case when correct then 10 else -10 end end as points_awarded
    from outcomes
  ) select coalesce(jsonb_agg(jsonb_build_object('id', id, 'entry_id', entry_id,
      'points_awarded', points_awarded, 'is_correct', correct)), '[]'::jsonb),
    count(*), count(*) filter (where scoreable), count(*) filter (where status in ('postponed','cancelled'))
    into selection_results, selection_count, scored_count, void_count from points;

  perform e.id from public.entries e where e.id in
    (select (v->>'id')::uuid from jsonb_array_elements(snapshot->'entries') v)
    order by e.id for update nowait;
  perform s.id from public.entry_selections s where s.id in
    (select (v->>'id')::uuid from jsonb_array_elements(selection_results) v)
    order by s.id for update nowait;

  update public.entry_selections s set points_awarded = r.points_awarded, is_correct = r.is_correct
    from jsonb_to_recordset(selection_results) as r(id uuid, entry_id uuid, points_awarded integer, is_correct boolean)
    where s.id = r.id and s.entry_id = r.entry_id
      and row(s.points_awarded, s.is_correct) is distinct from row(r.points_awarded, r.is_correct);
  get diagnostics selections_changed = row_count;

  with totals as (
    select e.id, e.submitted_at,
      case when e.submitted_at is not null and final_ready then
        coalesce((select sum(r.points_awarded) from jsonb_to_recordset(selection_results)
          as r(entry_id uuid, points_awarded integer) where r.entry_id = e.id), 0)
        + case when e.total_goals_prediction = goal_total then 10 else 0 end
      else null end as score
    from jsonb_populate_recordset(null::public.entries, snapshot->'entries') e
  ) update public.entries e set calculated_score = t.score,
      score_calculated_at = case when t.submitted_at is not null and final_ready then scoring_time else null end
    from totals t where e.id = t.id and (e.calculated_score is distinct from t.score
      or (e.score_calculated_at is null) is distinct from (t.submitted_at is null or not final_ready));
  get diagnostics entries_changed = row_count;
  select count(*), count(*) filter (where e.submitted_at is not null) into all_entry_count, entry_count
    from jsonb_populate_recordset(null::public.entries, snapshot->'entries') e;

  result := jsonb_build_object('seasonId', check_season_id, 'matchdayId', check_matchday_id,
    'matchdayNumber', md.matchday_number, 'entriesFound', entry_count,
    'selectionsScored', scored_count, 'selectionsAwaitingResults', selection_count - scored_count - void_count,
    'voidSelections', void_count, 'entriesFinalized', case when final_ready then entry_count else 0 end,
    'entriesSkipped', case when final_ready then 0 else entry_count end,
    'finalScoringReady', final_ready, 'recalculatedAt', scoring_time, 'matchdayStatus', lifecycle,
    'requestedScoringRevision', check_scoring_revision, 'acknowledgedRevision', check_scoring_revision,
    'selectionRowsConsidered', selection_count, 'selectionRowsChanged', selections_changed,
    'entryRowsConsidered', all_entry_count, 'entryRowsChanged', entries_changed, 'reused', false);

  perform id from public.matchdays where id = check_matchday_id for update nowait;
  update public.matchdays set status = lifecycle, scoring_pending = false,
    scored_revision = check_scoring_revision, scoring_result = result
    where id = check_matchday_id and season_id = check_season_id
      and scoring_revision = check_scoring_revision and status = md.status;
  if not found then
    raise exception 'Scoring inputs or lifecycle changed during calculation; retry required' using errcode = '40001';
  end if;
  return result;
end;
$$;

commit;
