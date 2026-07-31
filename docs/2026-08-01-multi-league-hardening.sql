-- Final multi-league boundary hardening. Safe to run after 2026-07-31-leagues.sql.
-- Idempotent: functions, triggers, and policies are replaced by stable names.

begin;

alter table public.seasons
alter column league_id set not null;

create or replace function public.is_active_league_member(
  check_league_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.league_memberships membership
    join public.profiles profile on profile.id = membership.user_id
    join public.leagues league on league.id = membership.league_id
    where membership.league_id = check_league_id
      and membership.user_id = check_user_id
      and membership.status = 'active'
      and profile.status = 'approved'
      and league.status = 'active'
  );
$$;

create or replace function public.is_league_admin(
  check_league_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin(check_user_id)
    or exists (
      select 1
      from public.league_memberships membership
      join public.profiles profile on profile.id = membership.user_id
      join public.leagues league on league.id = membership.league_id
      where membership.league_id = check_league_id
        and membership.user_id = check_user_id
        and membership.role = 'league_admin'
        and membership.status = 'active'
        and profile.status = 'approved'
        and league.status = 'active'
    );
$$;

create or replace function public.can_access_season(
  check_season_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin(check_user_id)
    or exists (
      select 1
      from public.seasons season
      where season.id = check_season_id
        and public.is_active_league_member(season.league_id, check_user_id)
    );
$$;

revoke all on function public.is_active_league_member(uuid, uuid) from public;
revoke all on function public.is_league_admin(uuid, uuid) from public;
revoke all on function public.can_access_season(uuid, uuid) from public;
grant execute on function public.is_active_league_member(uuid, uuid) to authenticated;
grant execute on function public.is_league_admin(uuid, uuid) to authenticated;
grant execute on function public.can_access_season(uuid, uuid) to authenticated;

do $$
begin
  if exists (
    select 1
    from public.gameweeks gameweek
    join public.seasons season on season.id = gameweek.season_id
    where season.status = 'active'
      and gameweek.fixture_picker_id is not null
      and not public.is_active_league_member(
        season.league_id,
        gameweek.fixture_picker_id
      )
  ) then
    raise exception
      'Active gameweeks contain a picker who is not an approved active league member';
  end if;

  if exists (
    select 1
    from public.joker_usage joker
    join public.fixtures fixture on fixture.id = joker.fixture_id
    join public.gameweeks gameweek on gameweek.id = fixture.gameweek_id
    where joker.season_id <> gameweek.season_id
  ) then
    raise exception 'Joker rows contain a season/fixture mismatch';
  end if;
end;
$$;

create or replace function public.validate_gameweek_picker_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_league_id uuid;
begin
  if new.fixture_picker_id is null then
    return new;
  end if;

  select season.league_id
  into target_league_id
  from public.seasons season
  where season.id = new.season_id;

  if target_league_id is null
    or not public.is_active_league_member(target_league_id, new.fixture_picker_id)
  then
    raise exception 'Fixture picker must be an approved active member of the season league';
  end if;

  return new;
end;
$$;

drop trigger if exists gameweeks_validate_picker_membership on public.gameweeks;
create trigger gameweeks_validate_picker_membership
before insert or update of season_id, fixture_picker_id
on public.gameweeks
for each row
execute function public.validate_gameweek_picker_membership();

revoke all on function public.validate_gameweek_picker_membership() from public;

create or replace function public.validate_joker_season_fixture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fixture_season_id uuid;
begin
  select gameweek.season_id
  into fixture_season_id
  from public.fixtures fixture
  join public.gameweeks gameweek on gameweek.id = fixture.gameweek_id
  where fixture.id = new.fixture_id;

  if fixture_season_id is null or fixture_season_id <> new.season_id then
    raise exception 'Joker season must match the fixture season';
  end if;

  return new;
end;
$$;

drop trigger if exists joker_usage_validate_season_fixture on public.joker_usage;
create trigger joker_usage_validate_season_fixture
before insert or update of season_id, fixture_id
on public.joker_usage
for each row
execute function public.validate_joker_season_fixture();

revoke all on function public.validate_joker_season_fixture() from public;

-- Replace the original global approved-user social reads with league-scoped reads.
drop policy if exists "Approved users can read prediction reactions"
on public.prediction_reactions;
drop policy if exists "League members can read prediction reactions"
on public.prediction_reactions;
create policy "League members can read prediction reactions"
on public.prediction_reactions
for select
using (public.can_access_season(season_id));

drop policy if exists "Approved users can read notification reactions"
on public.notification_reactions;
drop policy if exists "League members can read notification reactions"
on public.notification_reactions;
create policy "League members can read notification reactions"
on public.notification_reactions
for select
using (public.can_access_season(season_id));

drop policy if exists "Approved users can read notification comments"
on public.notification_comments;
drop policy if exists "League members can read notification comments"
on public.notification_comments;
create policy "League members can read notification comments"
on public.notification_comments
for select
using (public.can_access_season(season_id));

drop policy if exists "Approved users can read notification comment reactions"
on public.notification_comment_reactions;
drop policy if exists "League members can read notification comment reactions"
on public.notification_comment_reactions;
create policy "League members can read notification comment reactions"
on public.notification_comment_reactions
for select
using (public.can_access_season(season_id));

notify pgrst, 'reload schema';

commit;
