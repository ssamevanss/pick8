begin;

-- Permanent void settlement for postponed and replayed fixtures.
--
-- Policy: when a fixture is postponed to another date, or abandoned and replayed,
-- the original predictions on it are void for good. The fixture scores nothing for
-- anyone, its goals never count towards Total Goals, the matchday completes on the
-- remaining fixtures, and a later reschedule, replay or provider status update can
-- not bring the fixture back. Completed scores and standings do not move.
--
-- Representation: fixtures.voided_at / void_reason. The provider-mirrored columns
-- (status, kickoff_at, scores) keep following the provider exactly, so sync
-- fingerprints and verification are unchanged; the void is an overlay that scoring
-- reads and that a trigger makes irreversible.
--
-- Additive and backward compatible: nothing is backfilled, so existing fixtures and
-- matchdays keep their current scores. A fixture that is 'postponed' today becomes
-- permanently void the next time its row changes (including a reschedule).

alter table public.fixtures
  add column voided_at timestamptz,
  add column void_reason text,
  add constraint fixtures_void_reason_check check (
    (voided_at is null and void_reason is null)
    or (voided_at is not null and void_reason in ('postponed', 'rescheduled', 'abandoned', 'expired', 'manual'))
  );

create index fixtures_voided_idx on public.fixtures (matchday_id) where voided_at is not null;
-- Candidates for the 14 day expiry below; tiny, since interrupted matches are rare.
create index fixtures_interrupted_idx on public.fixtures (kickoff_at)
  where voided_at is null and status in ('suspended', 'abandoned');

-- Interrupted matches are held, not voided: Who You Got serves SUSPENDED and
-- ABANDONED as 'cancelled' with providerStatus naming the real state, and Pick8
-- stores them as non-terminal 'suspended' / 'abandoned' until the provider resolves
-- them (resumes -> scored, new date or postponed -> void) or they expire (below).
alter table public.fixtures drop constraint fixtures_status_check;
alter table public.fixtures add constraint fixtures_status_check check (
  status in ('scheduled', 'timed', 'in_play', 'paused', 'finished', 'postponed', 'cancelled', 'suspended', 'abandoned')
);

-- How long a suspended or abandoned match may stay unresolved before it is voided.
-- Matches Who You Got's late-correction window (it stops re-reading a fixture 14
-- days after kickoff), so the game never waits on a provider that has stopped asking.
create or replace function public.pick8_interrupted_fixture_expiry()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '14 days' $$;

create or replace function public.pick8_london_day(check_instant timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (check_instant at time zone 'Europe/London')::date
$$;

-- The decision. It runs inside the same statement that stores the provider's data, so
-- it cannot be skipped, reordered or lost between a sync and a scoring run.
--   postponed   the provider reports POSTPONED for a match that has not started.
--   rescheduled a match that has not started moves to a later calendar day
--               (Europe/London), before or after the entry deadline. A shorter move,
--               such as a delayed kickoff on the same day, is the same scheduled match.
--   abandoned   a match that was abandoned is scheduled again (status back to
--               scheduled/timed, or the same later-day move): the replay is confirmed.
--               Who You Got's result polls never rewrite kickoff_at, so the status
--               change is the first signal a replay can give.
--   expired     (settle_expired_pick8_interrupted_fixtures) a suspended or abandoned
--               match still unresolved 14 days after its kickoff.
-- A started or finished match is never voided by a kickoff change. Once voided, a
-- fixture stays voided whatever the provider sends next.
create or replace function public.decide_pick8_fixture_void()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matchday_mode text;
  decided text;
begin
  if tg_op = 'UPDATE' and old.voided_at is not null then
    new.voided_at := old.voided_at;
    new.void_reason := old.void_reason;
    return new;
  end if;

  if coalesce(auth.role(), '') not in ('', 'service_role') then
    new.voided_at := case when tg_op = 'UPDATE' then old.voided_at else null end;
    new.void_reason := case when tg_op = 'UPDATE' then old.void_reason else null end;
    return new;
  end if;

  if new.voided_at is not null then
    return new;
  end if;

  select m.fixture_sync_mode into matchday_mode from public.matchdays m where m.id = new.matchday_id;
  if matchday_mode is distinct from 'provider' then
    return new;
  end if;

  if new.status = 'postponed'
    and (tg_op = 'INSERT' or old.status not in ('in_play', 'paused', 'finished'))
  then
    decided := 'postponed';
  elsif tg_op = 'UPDATE' and old.status = 'abandoned' and new.status in ('scheduled', 'timed') then
    decided := 'abandoned';
  elsif tg_op = 'UPDATE'
    and old.status not in ('in_play', 'paused', 'finished')
    and new.kickoff_at > old.kickoff_at
    and public.pick8_london_day(new.kickoff_at) > public.pick8_london_day(old.kickoff_at)
  then
    decided := case when old.status = 'abandoned' then 'abandoned' else 'rescheduled' end;
  end if;

  if decided is not null then
    new.voided_at := clock_timestamp();
    new.void_reason := decided;
  end if;
  return new;
end;
$$;
revoke all on function public.decide_pick8_fixture_void() from public, anon, authenticated;

drop trigger if exists fixtures_decide_permanent_void on public.fixtures;
create trigger fixtures_decide_permanent_void
before insert or update on public.fixtures
for each row execute function public.decide_pick8_fixture_void();

-- The owner's tool for a decision the provider data cannot make, such as a match
-- left SUSPENDED indefinitely. Service role only; there is deliberately no inverse.
create or replace function public.void_pick8_fixture(check_fixture_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.fixtures%rowtype;
begin
  if coalesce(auth.role(), '') not in ('', 'service_role') then
    raise exception 'Voiding a fixture requires service_role' using errcode = '42501';
  end if;
  select * into target from public.fixtures where id = check_fixture_id for update;
  if not found then
    raise exception 'Fixture not found' using errcode = '22023';
  end if;
  if target.voided_at is null then
    update public.fixtures set voided_at = clock_timestamp(), void_reason = 'manual'
    where id = check_fixture_id returning * into target;
    return jsonb_build_object('fixtureId', target.id, 'matchdayId', target.matchday_id,
      'voidedAt', target.voided_at, 'reason', target.void_reason, 'alreadyVoided', false);
  end if;
  return jsonb_build_object('fixtureId', target.id, 'matchdayId', target.matchday_id,
    'voidedAt', target.voided_at, 'reason', target.void_reason, 'alreadyVoided', true);
end;
$$;
revoke all on function public.void_pick8_fixture(uuid) from public, anon, authenticated;
grant execute on function public.void_pick8_fixture(uuid) to service_role;


-- Voids suspended and abandoned matches that nobody resolved within the expiry window.
-- Time passing is not a provider update, so nothing in the sync path would ever notice:
-- the cron orchestration calls this when discover_pick8_due_work reports expired
-- candidates, from whichever scheduled job runs first. It works on local data only, so it
-- still runs after Who You Got has stopped re-reading the fixture. The UPDATE goes through
-- the normal triggers: the fixture is stamped void, and the matchday is flagged for
-- fixture application and scoring, which completes it on the remaining fixtures.
-- Completed matchdays are left alone (their scores and standings do not move), and so are
-- manual and accelerated-test matchdays. Idempotent: voided fixtures are never candidates.
create or replace function public.settle_expired_pick8_interrupted_fixtures(
  check_now timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  voided jsonb;
begin
  if coalesce(auth.role(), '') not in ('', 'service_role') then
    raise exception 'Settling interrupted fixtures requires service_role' using errcode = '42501';
  end if;
  with expired as (
    update public.fixtures f
    set voided_at = clock_timestamp(), void_reason = 'expired'
    from public.matchdays m
    where m.id = f.matchday_id
      and m.fixture_sync_mode = 'provider'
      and m.status <> 'completed'
      and f.voided_at is null
      and f.status in ('suspended', 'abandoned')
      and f.kickoff_at + public.pick8_interrupted_fixture_expiry() <= check_now
    returning f.id, f.matchday_id, f.external_fixture_id, f.status
  )
  select coalesce(jsonb_agg(jsonb_build_object('fixtureId', id, 'matchdayId', matchday_id,
    'externalFixtureId', external_fixture_id, 'status', status) order by id), '[]'::jsonb)
  into voided from expired;
  return jsonb_build_object('voided', voided, 'count', jsonb_array_length(voided));
end;
$$;
revoke all on function public.settle_expired_pick8_interrupted_fixtures(timestamptz) from public, anon, authenticated;
grant execute on function public.settle_expired_pick8_interrupted_fixtures(timestamptz) to service_role;

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
  -- fixture category are present. Postponed/cancelled fixtures remain void, and a
  -- permanently voided fixture (voided_at) is void whatever the provider now says:
  -- it is terminal, scores nothing, contributes no goals, and its rescheduled
  -- kickoff does not hold the matchday open.
  select count(*) > 0 and coalesce(bool_and(
      f.voided_at is not null or (
        f.status in ('finished','postponed','cancelled')
        and (f.status <> 'finished' or (f.home_score is not null and f.away_score is not null)))
    ), false),
    coalesce(bool_or(f.kickoff_at > scoring_time and f.voided_at is null), false),
    coalesce(bool_or(f.status in ('in_play','paused','finished') or f.kickoff_at <= scoring_time), false),
    coalesce(sum(case when f.voided_at is null and f.status = 'finished'
      and f.home_score is not null and f.away_score is not null
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
    where f.id is null or (f.voided_at is null and f.status = 'finished' and f.home_score is not null and f.away_score is not null
      and s.category in ('team_win','team_lose','team_score','clean_sheet')
      and (s.selected_team_side is null or s.selected_team_side not in ('home','away')))) then
    raise exception 'Selection fixture missing or selected team invalid';
  end if;

  with inputs as (
    select s.id, s.entry_id, s.category, f.status,
      f.voided_at is not null or f.status in ('postponed','cancelled') as is_void,
      f.voided_at is null and f.status = 'finished' and f.home_score is not null and f.away_score is not null as scoreable,
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
    count(*), count(*) filter (where scoreable), count(*) filter (where is_void)
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

create or replace function public.discover_pick8_due_work(
  check_policy text default 'results',
  check_now timestamptz default now(),
  check_limit integer default 12
)
returns jsonb language sql stable security invoker set search_path = '' as $$
with active_season as (
  select s.* from public.seasons s where s.is_active order by s.provider_season desc limit 1
), fixture_state as (
  select f.matchday_id, count(*) as fixture_count,
    min(f.kickoff_at) filter (where f.voided_at is null) as first_kickoff_at,
    max(f.kickoff_at) filter (where f.voided_at is null) as last_kickoff_at,
    bool_or(f.status in ('in_play','paused') and f.voided_at is null) as has_live_fixture,
    bool_and(f.voided_at is not null or f.status in ('finished','postponed','cancelled')) as all_terminal,
    coalesce(jsonb_agg(f.external_fixture_id order by f.external_fixture_id) filter (where f.voided_at is not null), '[]'::jsonb) as voided_ids
  from public.fixtures f join public.matchdays m on m.id = f.matchday_id
  join active_season s on s.id = m.season_id group by f.matchday_id
), base as (
  select m.*, coalesce(fs.fixture_count,0) as fixture_count, fs.first_kickoff_at,
    fs.last_kickoff_at, coalesce(fs.has_live_fixture,false) as has_live_fixture,
    coalesce(fs.all_terminal,false) as all_terminal, coalesce(fs.voided_ids,'[]'::jsonb) as voided_ids,
    (m.fixture_sync_mode = 'provider' and (
      (m.next_provider_check_at is not null and m.next_provider_check_at <= check_now) or
      (m.next_provider_check_at is null and (
        m.status = 'scoring' or coalesce(fs.has_live_fixture,false) or
        (fs.last_kickoff_at between check_now - interval '4 hours' and check_now + interval '30 minutes') or
        (m.status = 'completed' and m.applied_fixture_fingerprint is null and
          fs.last_kickoff_at >= check_now - interval '2 days')
      ))
    )) as provider_due
  from public.matchdays m join active_season s on s.id = m.season_id
  left join fixture_state fs on fs.matchday_id = m.id
), progress as (
  select coalesce(max(matchday_number) filter (where status <> 'upcoming'),0) + 1 as next_number,
    min(matchday_number) filter (where status = 'upcoming') as first_upcoming from base
), daily_numbers as (
  select matchday_number from base where fixture_sync_mode='provider' and status in ('open','scoring')
  union
  select n from progress p cross join lateral generate_series(
    least(coalesce(p.first_upcoming,p.next_number),p.next_number),
    least(38,least(coalesce(p.first_upcoming,p.next_number),p.next_number)+2)
  ) n where not exists (
    select 1 from base occupied where occupied.matchday_number = n and occupied.fixture_sync_mode = 'manual'
  )
), eligible as (
  select b.*,
    case when check_policy='fixtures' then b.matchday_number in (select matchday_number from daily_numbers)
      when check_policy='reconciliation' then b.provider_due or b.scoring_pending or b.fixture_application_pending or b.sync_pending
        or b.status='scoring' or (b.last_kickoff_at >= date_trunc('day',check_now)-interval '2 days'
          and b.last_kickoff_at < date_trunc('day',check_now))
      else b.provider_due or b.scoring_pending or b.fixture_application_pending or b.sync_pending end as selected,
    case when check_policy in ('fixtures','reconciliation') then true else b.provider_due end as policy_provider_due
  from base b
), due as (
  select * from eligible where selected order by matchday_number limit greatest(1,least(check_limit,38))
)
select jsonb_build_object(
  'expiredInterruptedFixtureCount', (select count(*) from public.fixtures f
    join public.matchdays m on m.id = f.matchday_id
    where m.fixture_sync_mode = 'provider' and m.status <> 'completed' and f.voided_at is null
      and f.status in ('suspended','abandoned')
      and f.kickoff_at + public.pick8_interrupted_fixture_expiry() <= check_now),
  'season', (select jsonb_build_object('id',s.id,'name',s.name,'providerSeason',s.provider_season,
    'competitionRefreshPending',s.competition_refresh_pending,'competitionRevision',s.competition_revision,
    'competitionRefreshAfter',s.competition_refresh_after,
    'lifecycleRecoveryDue',s.competition_refresh_pending or
      (s.competition_refresh_after is not null and s.competition_refresh_after <= check_now)) from active_season s),
  'dailyMatchdayNumbers', coalesce((select jsonb_agg(matchday_number order by matchday_number)
    from daily_numbers),'[]'::jsonb),
  'matchdays', coalesce((select jsonb_agg(jsonb_build_object(
    'id',d.id,'matchdayNumber',d.matchday_number,'status',d.status,'locksAt',d.locks_at,
    'fixtureSyncMode',d.fixture_sync_mode,'syncRevision',d.sync_revision,
    'scoringRevision',d.scoring_revision,'scoredRevision',d.scored_revision,
    'appliedFixtureFingerprint',d.applied_fixture_fingerprint,
    'fixtureApplicationPending',d.fixture_application_pending or d.sync_pending,
    'scoringPending',d.scoring_pending,'nextProviderCheckAt',d.next_provider_check_at,
    'providerContentVersion',d.provider_content_version,
    'providerContentFingerprint',d.provider_content_fingerprint,
    'terminalFixtureFingerprint',d.terminal_fixture_fingerprint,
    'terminalConfirmedAt',d.terminal_confirmed_at,'fixtureCount',d.fixture_count,
    'firstKickoffAt',d.first_kickoff_at,'lastKickoffAt',d.last_kickoff_at,
    'hasLiveFixture',d.has_live_fixture,'allTerminal',d.all_terminal,'voidedExternalFixtureIds',d.voided_ids,
    'providerFreshnessDue',d.policy_provider_due,
    'localScoringRecoveryDue',d.scoring_pending,
    'fixtureApplicationRecoveryDue',d.fixture_application_pending or d.sync_pending,
    'competitionLifecycleRecoveryDue',(select s.competition_refresh_pending or
      (s.competition_refresh_after is not null and s.competition_refresh_after <= check_now) from active_season s),
    'dueReasons', to_jsonb(array_remove(array[
      case when d.policy_provider_due then 'provider_freshness' end,
      case when d.scoring_pending then 'local_scoring_recovery' end,
      case when d.fixture_application_pending or d.sync_pending then 'fixture_application_recovery' end,
      case when (select s.competition_refresh_pending or
        (s.competition_refresh_after is not null and s.competition_refresh_after <= check_now) from active_season s)
        then 'competition_lifecycle_recovery' end
    ],null))
  ) order by d.matchday_number) from due d),'[]'::jsonb)
);
$$;
revoke all on function public.discover_pick8_due_work(text,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.discover_pick8_due_work(text,timestamptz,integer) to service_role;

commit;
