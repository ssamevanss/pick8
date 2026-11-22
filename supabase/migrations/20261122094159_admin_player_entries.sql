begin;

-- Only the trusted server may write entries on behalf of another player.
-- No new authenticated table policies or changes to the normal player RPC.
create table public.pick8_entry_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  player_id uuid not null references public.profiles(id),
  matchday_id uuid not null references public.matchdays(id),
  entry_id uuid not null references public.entries(id),
  recorded_at timestamptz not null default clock_timestamp(),
  reason text not null check(length(btrim(reason)) between 5 and 1000),
  post_lock boolean not null,
  before_value jsonb,
  after_value jsonb not null
);
alter table public.pick8_entry_admin_audit enable row level security;
revoke all on public.pick8_entry_admin_audit from public, anon, authenticated, service_role;
grant select, insert on public.pick8_entry_admin_audit to service_role;
create index pick8_entry_admin_audit_matchday on public.pick8_entry_admin_audit(matchday_id, recorded_at);

create function public.admin_save_pick8_entry(
  check_actor_id uuid,
  check_player_id uuid,
  check_expected_updated_at timestamptz,
  check_reason text,
  check_allow_post_lock boolean,
  check_matchday_id uuid,
  check_intent text,
  check_total_goals integer,
  check_selections jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
set lock_timeout = '2s'
set statement_timeout = '10s'
as $$
declare
  actor_id uuid := check_player_id;
  before_value jsonb;
  after_value jsonb;
  post_lock boolean;
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
  processed_at timestamptz;
begin
  if current_user <> 'service_role' or not exists (
    select 1 from public.profiles where id = check_actor_id and is_admin and is_active
  ) then
    raise exception using errcode = '42501', message = 'Active administrator access is required';
  end if;
  if check_reason is null or length(btrim(check_reason)) < 5 or length(check_reason) > 1000 then
    raise exception using errcode = '22023', message = 'Provide a reason (5–1000 characters)';
  end if;
  if check_intent is null or check_intent not in ('draft', 'submit', 'save_changes') then
    raise exception using errcode = '22023', message = 'Invalid Pick8 save intent';
  end if;
  if check_selections is null or jsonb_typeof(check_selections) <> 'array' then
    raise exception using errcode = '22023', message = 'Selections must be an array';
  end if;

  if check_total_goals is not null and (check_total_goals < 0 or check_total_goals > 100) then
    raise exception using errcode = '23514', message = 'Total Goals must be between 0 and 100';
  end if;
  if exists (select 1 from jsonb_to_recordset(check_selections) as s(category text, selected_team_side text)
    where not coalesce(case
      when category = 'home_win' then selected_team_side = 'home'
      when category = 'away_win' then selected_team_side = 'away'
      when category in ('draw','btts') then selected_team_side is null
      when category in ('team_win','team_lose','team_score','clean_sheet') then selected_team_side in ('home','away')
      else false end, false)) then
    raise exception using errcode = '23514', message = 'Invalid category or selected team side';
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

  select public.pick8_entry_deadline(check_matchday_id) into first_kickoff;

  processed_at := clock_timestamp();
  if matchday_status is null or first_kickoff is null then
    raise exception using errcode = '23514', message = 'Matchday or fixtures unavailable';
  end if;
  post_lock := processed_at >= first_kickoff or matchday_status in ('scoring', 'completed');
  if post_lock and not coalesce(check_allow_post_lock, false) then
    raise exception using errcode = '42501', message = 'Confirm the authorised post-deadline administrative change';
  end if;
  if post_lock and check_intent = 'draft' then
    raise exception using errcode = '23514', message = 'Post-deadline changes must be complete submissions';
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

  if target_entry.updated_at is distinct from check_expected_updated_at then
    raise exception using errcode = '40001', message = 'Entry changed; reload before saving';
  end if;
  before_value := case when target_entry.id is null then null else
    jsonb_build_object('entry', to_jsonb(target_entry), 'selections', (
      select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)
      from public.entry_selections s where s.entry_id = target_entry.id)) end;
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

  -- Replace atomically so fixture swaps cannot collide with the per-entry unique constraint.
  -- Submitted completeness is also checked by the existing deferred constraint trigger.
  delete from public.entry_selections where entry_id = target_entry.id;
  insert into public.entry_selections(entry_id, category, fixture_id, selected_team_side, updated_at)
  select target_entry.id, s.category, s.fixture_id, s.selected_team_side, processed_at
  from jsonb_to_recordset(check_selections) as s(category text, fixture_id uuid, selected_team_side text);

  update public.entries
  set total_goals_prediction = check_total_goals,
      submitted_at = case when check_intent = 'submit' then processed_at else target_entry.submitted_at end,
      updated_at = processed_at
  where entries.id = target_entry.id
  returning * into target_entry;

  if not post_lock and clock_timestamp() >= first_kickoff then
    raise exception using errcode = '42501', message = 'Deadline passed while saving; reload and authorise a post-deadline change';
  end if;
  after_value := jsonb_build_object('entry', to_jsonb(target_entry), 'selections', (
    select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)
    from public.entry_selections s where s.entry_id = target_entry.id));
  insert into public.pick8_entry_admin_audit(actor_id, player_id, matchday_id, entry_id, reason, post_lock, before_value, after_value)
  values(check_actor_id, check_player_id, check_matchday_id, target_entry.id, btrim(check_reason), post_lock, before_value, after_value);
  return jsonb_build_object('entry_id', target_entry.id, 'submitted_at', target_entry.submitted_at);

end;
$$;

revoke all on function public.admin_save_pick8_entry(uuid,uuid,timestamptz,text,boolean,uuid,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.admin_save_pick8_entry(uuid,uuid,timestamptz,text,boolean,uuid,text,integer,jsonb) to service_role;

commit;
