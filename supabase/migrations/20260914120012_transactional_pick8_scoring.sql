begin;

-- A durable result identifies a committed scoring transaction after a lost
-- response, and permits fingerprint-only recovery without re-scoring.
alter table public.matchdays
  add column scored_revision bigint,
  add column scoring_result jsonb;

create function public.protect_pick8_scoring_checkpoint()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if coalesce(auth.role(), '') not in ('', 'service_role') then
    if (tg_op = 'INSERT' and (new.scored_revision is not null or new.scoring_result is not null))
      or (tg_op = 'UPDATE' and row(new.scored_revision, new.scoring_result)
        is distinct from row(old.scored_revision, old.scoring_result)) then
      raise exception 'Scoring checkpoint is server-managed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger matchdays_guard_scoring_checkpoint before insert or update on public.matchdays
for each row execute function public.protect_pick8_scoring_checkpoint();
revoke all on function public.protect_pick8_scoring_checkpoint() from public, anon, authenticated;

-- INVOKER deliberately uses the service role's existing table privileges.
-- This is not a SECURITY DEFINER API available to players or authenticated admins.
create function public.score_pick8_matchday(
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

  -- ONE statement snapshot: revision, lifecycle, fixtures, entries and picks.
  -- No parent row lock here: input writers lock children before their dirty
  -- triggers lock the matchday. Never wait on a child while holding its parent.
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

  select count(*) > 0 and coalesce(bool_and(f.status in ('finished','postponed','cancelled')), false),
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
      when category = 'clean_sheet' then goals_against = 0 end as correct
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

  -- Lock only snapshot children, entries then selections, in UUID order.
  -- NOWAIT handles writers using a different child order without a wait cycle.
  -- A missing/deleted/new input is caught by the final revision CAS.
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

  -- Parent lock LAST. No further child writes. Status is also guarded because
  -- status-only edits intentionally do not increment scoring_revision.
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
revoke all on function public.score_pick8_matchday(uuid, uuid, bigint, boolean) from public, anon, authenticated;
grant execute on function public.score_pick8_matchday(uuid, uuid, bigint, boolean) to service_role;

commit;
