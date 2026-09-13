begin;

-- Existing rows bootstrap on their next normal sync, rather than scheduling a
-- season-wide historical replay. New/input-modified rows carry durable work.
alter table public.matchdays
  add column applied_fixture_fingerprint text,
  add column last_upstream_check_at timestamptz,
  add column sync_pending boolean not null default false,
  add column scoring_pending boolean not null default false,
  add column sync_revision bigint not null default 0,
  add column scoring_revision bigint not null default 0;

alter table public.seasons
  add column competition_refresh_pending boolean not null default true,
  add column competition_revision bigint not null default 0,
  add column competition_refresh_after timestamptz;

create function public.invalidate_pick8_sync(check_matchday_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.matchdays set sync_pending = true, scoring_pending = true,
    sync_revision = sync_revision + 1, scoring_revision = scoring_revision + 1
  where id = check_matchday_id;
$$;
revoke all on function public.invalidate_pick8_sync(uuid) from public, anon, authenticated;

create function public.invalidate_pick8_fixture_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and
    (to_jsonb(new) - array['updated_at', 'created_at', 'last_synced_at']) is not distinct from
    (to_jsonb(old) - array['updated_at', 'created_at', 'last_synced_at']) then return new; end if;
  if tg_op <> 'INSERT' then perform public.invalidate_pick8_sync(old.matchday_id); end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.matchday_id is distinct from old.matchday_id) then
    perform public.invalidate_pick8_sync(new.matchday_id);
  end if;
  return coalesce(new, old);
end;
$$;
create trigger fixtures_invalidate_pick8_sync after insert or update or delete on public.fixtures
for each row execute function public.invalidate_pick8_fixture_sync();

create function public.invalidate_pick8_entry_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and row(new.matchday_id, new.submitted_at, new.total_goals_prediction)
    is not distinct from row(old.matchday_id, old.submitted_at, old.total_goals_prediction) then return new; end if;
  if tg_op <> 'INSERT' then perform public.invalidate_pick8_sync(old.matchday_id); end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.matchday_id is distinct from old.matchday_id) then
    perform public.invalidate_pick8_sync(new.matchday_id);
  end if;
  return coalesce(new, old);
end;
$$;
create trigger entries_invalidate_pick8_sync after insert or update or delete on public.entries
for each row execute function public.invalidate_pick8_entry_sync();

create function public.invalidate_pick8_selection_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and row(new.entry_id, new.fixture_id, new.category, new.selected_team_side)
    is not distinct from row(old.entry_id, old.fixture_id, old.category, old.selected_team_side) then return new; end if;
  if tg_op <> 'INSERT' then
    perform public.invalidate_pick8_sync(matchday_id) from public.entries where id = old.entry_id;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.entry_id is distinct from old.entry_id) then
    perform public.invalidate_pick8_sync(matchday_id) from public.entries where id = new.entry_id;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger entry_selections_invalidate_pick8_sync after insert or update or delete on public.entry_selections
for each row execute function public.invalidate_pick8_selection_sync();

create function public.track_pick8_matchday_lifecycle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if row(new.season_id, new.matchday_number, new.fixture_sync_mode, new.is_accelerated_test, new.status, new.opens_at, new.locks_at)
      is not distinct from row(old.season_id, old.matchday_number, old.fixture_sync_mode, old.is_accelerated_test, old.status, old.opens_at, old.locks_at) then return new; end if;
    new.sync_pending := true;
    new.sync_revision := old.sync_revision + 1;
    -- Status is also a scoring output. Do not invalidate the scorer's own
    -- input revision when it writes that output.
    if row(new.season_id, new.matchday_number, new.fixture_sync_mode, new.is_accelerated_test, new.opens_at, new.locks_at)
      is distinct from row(old.season_id, old.matchday_number, old.fixture_sync_mode, old.is_accelerated_test, old.opens_at, old.locks_at) then
      new.scoring_pending := true;
      new.scoring_revision := old.scoring_revision + 1;
    end if;
  end if;
  if tg_op <> 'INSERT' then
    update public.seasons set competition_refresh_pending = true, competition_revision = competition_revision + 1 where id = old.season_id;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.season_id is distinct from old.season_id) then
    update public.seasons set competition_refresh_pending = true, competition_revision = competition_revision + 1 where id = new.season_id;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger matchdays_track_sync_lifecycle before insert or update or delete on public.matchdays
for each row execute function public.track_pick8_matchday_lifecycle();

-- Metadata acknowledgements must not be writable through an authenticated
-- admin's ordinary table policy. Nested invalidation triggers remain allowed.
create function public.protect_pick8_sync_metadata()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') not in ('', 'service_role') and pg_trigger_depth() = 1 then
    if tg_table_name = 'matchdays' then
      if tg_op = 'INSERT' then
        if new.applied_fixture_fingerprint is not null or new.last_upstream_check_at is not null or new.sync_pending or new.scoring_pending or new.sync_revision <> 0 or new.scoring_revision <> 0 then
          raise exception 'Sync metadata is server-managed';
        end if;
      elsif row(new.applied_fixture_fingerprint, new.last_upstream_check_at, new.sync_pending, new.scoring_pending, new.sync_revision, new.scoring_revision)
        is distinct from row(old.applied_fixture_fingerprint, old.last_upstream_check_at, old.sync_pending, old.scoring_pending, old.sync_revision, old.scoring_revision) then
        raise exception 'Sync metadata is server-managed';
      end if;
    else
      if tg_op = 'INSERT' then
        if not new.competition_refresh_pending or new.competition_revision <> 0 or new.competition_refresh_after is not null then raise exception 'Sync metadata is server-managed'; end if;
      elsif row(new.competition_refresh_pending, new.competition_revision, new.competition_refresh_after)
        is distinct from row(old.competition_refresh_pending, old.competition_revision, old.competition_refresh_after) then
        raise exception 'Sync metadata is server-managed';
      end if;
    end if;
  end if;
  return new;
end;
$$;
-- Alphabetical BEFORE-trigger order: validate caller metadata before the
-- lifecycle trigger assigns server-owned invalidation fields.
create trigger matchdays_guard_sync_metadata before insert or update on public.matchdays
for each row execute function public.protect_pick8_sync_metadata();
create trigger seasons_guard_sync_metadata before insert or update on public.seasons
for each row execute function public.protect_pick8_sync_metadata();

revoke all on function public.invalidate_pick8_fixture_sync() from public, anon, authenticated;
revoke all on function public.invalidate_pick8_entry_sync() from public, anon, authenticated;
revoke all on function public.invalidate_pick8_selection_sync() from public, anon, authenticated;
revoke all on function public.track_pick8_matchday_lifecycle() from public, anon, authenticated;
revoke all on function public.protect_pick8_sync_metadata() from public, anon, authenticated;

commit;
