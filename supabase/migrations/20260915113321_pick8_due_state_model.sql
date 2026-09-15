begin;

-- Provider freshness, provider application and local scoring are separate
-- checkpoints. Keep sync_pending during the rollout as a compatibility mirror
-- of fixture_application_pending; new orchestration reads the explicit name.
alter table public.matchdays
  add column fixture_application_pending boolean not null default false,
  add column next_provider_check_at timestamptz,
  add column provider_content_version text,
  add column provider_content_fingerprint text,
  add column terminal_fixture_fingerprint text,
  add column terminal_confirmed_at timestamptz;

update public.matchdays
set fixture_application_pending = sync_pending;

create index matchdays_due_provider_check_idx
on public.matchdays (next_provider_check_at, season_id, matchday_number)
where fixture_sync_mode = 'provider';

create index matchdays_local_recovery_idx
on public.matchdays (season_id, matchday_number)
where scoring_pending or fixture_application_pending or sync_pending;

-- Fixture content can make both provider application and scoring stale.
create or replace function public.invalidate_pick8_sync(check_matchday_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.matchdays set sync_pending = true,
    fixture_application_pending = true, scoring_pending = true,
    sync_revision = sync_revision + 1, scoring_revision = scoring_revision + 1
  where id = check_matchday_id;
$$;

-- Entry changes are local scoring inputs. They must never manufacture provider
-- freshness or application work.
create or replace function public.invalidate_pick8_entry_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and row(new.matchday_id, new.submitted_at, new.total_goals_prediction)
    is not distinct from row(old.matchday_id, old.submitted_at, old.total_goals_prediction) then return new; end if;
  if tg_op <> 'INSERT' then
    update public.matchdays set scoring_pending = true,
      scoring_revision = scoring_revision + 1 where id = old.matchday_id;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.matchday_id is distinct from old.matchday_id) then
    update public.matchdays set scoring_pending = true,
      scoring_revision = scoring_revision + 1 where id = new.matchday_id;
  end if;
  return coalesce(new, old);
end;
$$;

-- Selection changes follow the same local-only recovery path.
create or replace function public.invalidate_pick8_selection_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and row(new.entry_id, new.fixture_id, new.category, new.selected_team_side)
    is not distinct from row(old.entry_id, old.fixture_id, old.category, old.selected_team_side) then return new; end if;
  if tg_op <> 'INSERT' then
    update public.matchdays set scoring_pending = true,
      scoring_revision = scoring_revision + 1
    where id = (select matchday_id from public.entries where id = old.entry_id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.entry_id is distinct from old.entry_id) then
    update public.matchdays set scoring_pending = true,
      scoring_revision = scoring_revision + 1
    where id = (select matchday_id from public.entries where id = new.entry_id);
  end if;
  return coalesce(new, old);
end;
$$;

-- Lifecycle edits have their own local recovery and competition checkpoint.
-- They do not imply that provider content is stale.
create or replace function public.track_pick8_matchday_lifecycle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if row(new.season_id, new.matchday_number, new.fixture_sync_mode, new.is_accelerated_test, new.status, new.opens_at, new.locks_at)
      is not distinct from row(old.season_id, old.matchday_number, old.fixture_sync_mode, old.is_accelerated_test, old.status, old.opens_at, old.locks_at) then return new; end if;
    if row(new.season_id, new.matchday_number, new.fixture_sync_mode, new.is_accelerated_test, new.opens_at, new.locks_at)
      is distinct from row(old.season_id, old.matchday_number, old.fixture_sync_mode, old.is_accelerated_test, old.opens_at, old.locks_at) then
      new.scoring_pending := true;
      new.scoring_revision := old.scoring_revision + 1;
    end if;
  end if;
  if tg_op <> 'INSERT' then
    update public.seasons set competition_refresh_pending = true,
      competition_revision = competition_revision + 1 where id = old.season_id;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.season_id is distinct from old.season_id) then
    update public.seasons set competition_refresh_pending = true,
      competition_revision = competition_revision + 1 where id = new.season_id;
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.protect_pick8_sync_metadata()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') not in ('', 'service_role') and pg_trigger_depth() = 1 then
    if tg_table_name = 'matchdays' then
      if tg_op = 'INSERT' then
        if new.applied_fixture_fingerprint is not null or new.last_upstream_check_at is not null
          or new.sync_pending or new.fixture_application_pending or new.scoring_pending
          or new.sync_revision <> 0 or new.scoring_revision <> 0
          or new.next_provider_check_at is not null or new.terminal_fixture_fingerprint is not null
          or new.provider_content_version is not null
          or new.provider_content_fingerprint is not null
          or new.terminal_confirmed_at is not null then
          raise exception 'Sync metadata is server-managed';
        end if;
      elsif row(new.applied_fixture_fingerprint, new.last_upstream_check_at,
          new.sync_pending, new.fixture_application_pending, new.scoring_pending,
          new.sync_revision, new.scoring_revision, new.next_provider_check_at,
          new.provider_content_version, new.provider_content_fingerprint,
          new.terminal_fixture_fingerprint, new.terminal_confirmed_at)
        is distinct from row(old.applied_fixture_fingerprint, old.last_upstream_check_at,
          old.sync_pending, old.fixture_application_pending, old.scoring_pending,
          old.sync_revision, old.scoring_revision, old.next_provider_check_at,
          old.provider_content_version, old.provider_content_fingerprint,
          old.terminal_fixture_fingerprint, old.terminal_confirmed_at) then
        raise exception 'Sync metadata is server-managed';
      end if;
    else
      if tg_op = 'INSERT' then
        if not new.competition_refresh_pending or new.competition_revision <> 0 or new.competition_refresh_after is not null then
          raise exception 'Sync metadata is server-managed';
        end if;
      elsif row(new.competition_refresh_pending, new.competition_revision, new.competition_refresh_after)
        is distinct from row(old.competition_refresh_pending, old.competition_revision, old.competition_refresh_after) then
        raise exception 'Sync metadata is server-managed';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- One bounded request supplies all orchestration metadata. It aggregates only
-- the active season and returns only due matchdays (plus the lifecycle flag).
create function public.discover_pick8_due_work(
  check_policy text default 'results',
  check_now timestamptz default now(),
  check_limit integer default 12
)
returns jsonb language sql stable security invoker set search_path = '' as $$
with active_season as (
  select s.* from public.seasons s where s.is_active order by s.provider_season desc limit 1
), fixture_state as (
  select f.matchday_id, count(*) as fixture_count, min(f.kickoff_at) as first_kickoff_at,
    max(f.kickoff_at) as last_kickoff_at,
    bool_or(f.status in ('in_play','paused')) as has_live_fixture,
    bool_and(f.status in ('finished','postponed','cancelled')) as all_terminal
  from public.fixtures f join public.matchdays m on m.id = f.matchday_id
  join active_season s on s.id = m.season_id group by f.matchday_id
), base as (
  select m.*, coalesce(fs.fixture_count,0) as fixture_count, fs.first_kickoff_at,
    fs.last_kickoff_at, coalesce(fs.has_live_fixture,false) as has_live_fixture,
    coalesce(fs.all_terminal,false) as all_terminal,
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
    'hasLiveFixture',d.has_live_fixture,'allTerminal',d.all_terminal,
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
