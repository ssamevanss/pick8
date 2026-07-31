begin;

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  slug text unique,
  created_by uuid not null references public.profiles(id),
  status text not null default 'active'
    check (status in ('active', 'archived', 'disabled')),
  default_base_provider text,
  default_base_competition_code text,
  default_base_competition_name text,
  default_base_competition_external_id text,
  creation_key uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leagues
add column if not exists creation_key uuid;

create unique index if not exists leagues_creator_creation_key_unique
on public.leagues (created_by, creation_key)
where creation_key is not null;

create table if not exists public.league_memberships (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'player'
    check (role in ('player', 'league_admin')),
  status text not null default 'active'
    check (status in ('active', 'removed', 'left')),
  joined_at timestamptz not null default now(),
  invited_by uuid references public.profiles(id),
  removed_at timestamptz,
  removed_by uuid references public.profiles(id),
  unique (league_id, user_id)
);

create table if not exists public.league_invites (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  code text not null unique,
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  use_count integer not null default 0 check (use_count >= 0),
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.seasons
add column if not exists league_id uuid references public.leagues(id);

alter table public.profiles
add column if not exists default_league_id uuid
references public.leagues(id) on delete set null;

create index if not exists league_memberships_user_status_idx
on public.league_memberships (user_id, status);

create index if not exists league_memberships_league_status_idx
on public.league_memberships (league_id, status);

create index if not exists league_invites_league_active_idx
on public.league_invites (league_id, disabled_at);

create index if not exists seasons_league_status_idx
on public.seasons (league_id, status);

create index if not exists gameweeks_season_number_idx
on public.gameweeks (season_id, gameweek_number);

create index if not exists gameweeks_season_picker_number_idx
on public.gameweeks (season_id, fixture_picker_id, gameweek_number);

create index if not exists fixtures_gameweek_idx
on public.fixtures (gameweek_id);

create index if not exists predictions_user_fixture_idx
on public.predictions (user_id, fixture_id);

do $$
declare
  default_creator uuid;
  backfill_league_id uuid;
begin
  select id
  into default_creator
  from public.profiles
  where status = 'approved'
  order by case when role = 'admin' then 0 else 1 end, id
  limit 1;

  if default_creator is null and exists (select 1 from public.seasons) then
    raise exception
      'Cannot backfill leagues: existing seasons require at least one approved profile';
  end if;

  if default_creator is not null then
    insert into public.leagues (
      name,
      slug,
      created_by,
      status,
      default_base_provider,
      default_base_competition_code,
      default_base_competition_name,
      default_base_competition_external_id
    )
    select
      'Who You Got? Default League',
      'who-you-got-default',
      default_creator,
      'active',
      season.base_provider,
      season.base_competition_code,
      season.base_competition_name,
      season.base_competition_external_id
    from (
      select
        base_provider,
        base_competition_code,
        base_competition_name,
        base_competition_external_id
      from public.seasons
      where status = 'active'
      order by created_at desc nulls last
      limit 1
    ) season
    on conflict (slug) do nothing;

    if not exists (
      select 1 from public.leagues where slug = 'who-you-got-default'
    ) then
      insert into public.leagues (name, slug, created_by)
      values (
        'Who You Got? Default League',
        'who-you-got-default',
        default_creator
      )
      on conflict (slug) do nothing;
    end if;

    select id
    into backfill_league_id
    from public.leagues
    where slug = 'who-you-got-default';

    update public.seasons
    set league_id = backfill_league_id
    where league_id is null;

    insert into public.league_memberships (
      league_id,
      user_id,
      role,
      status
    )
    select
      backfill_league_id,
      profile.id,
      case
        when profile.role = 'admin' then 'league_admin'
        else 'player'
      end,
      'active'
    from public.profiles profile
    where profile.status = 'approved'
    on conflict (league_id, user_id) do update
    set
      role = excluded.role,
      status = 'active',
      removed_at = null,
      removed_by = null;
  end if;
end
$$;

do $$
declare
  candidate_name text;
  existing_definition text;
  constraint_name text;
begin
  foreach candidate_name in array array[
    'seasons_one_active_idx',
    'seasons_one_active_unique'
  ]
  loop
    select indexdef
    into existing_definition
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'seasons'
      and indexname = candidate_name;

    if existing_definition is null then
      continue;
    end if;

    if lower(existing_definition) like '%unique index%'
      and lower(existing_definition) like '%where%active%'
      and lower(existing_definition) not like '%league_id%'
    then
      select constraint_row.conname
      into constraint_name
      from pg_constraint constraint_row
      join pg_class index_row on index_row.oid = constraint_row.conindid
      join pg_namespace namespace_row
        on namespace_row.oid = index_row.relnamespace
      where namespace_row.nspname = 'public'
        and index_row.relname = candidate_name;

      if constraint_name is not null then
        execute format(
          'alter table public.seasons drop constraint %I',
          constraint_name
        );
      else
        execute format('drop index public.%I', candidate_name);
      end if;
    else
      raise notice
        'Kept % because it is not a recognized global active-season unique index: %',
        candidate_name,
        existing_definition;
    end if;

    existing_definition := null;
    constraint_name := null;
  end loop;
end
$$;

create unique index if not exists seasons_one_active_per_league_unique
on public.seasons (league_id)
where status = 'active';

create or replace function public.is_platform_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = check_user_id
      and status = 'approved'
      and role = 'admin'
  );
$$;

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

revoke all on function public.is_platform_admin(uuid) from public;
revoke all on function public.is_active_league_member(uuid, uuid) from public;
revoke all on function public.is_league_admin(uuid, uuid) from public;
grant execute on function public.is_platform_admin(uuid) to authenticated;
grant execute on function public.is_active_league_member(uuid, uuid) to authenticated;
grant execute on function public.is_league_admin(uuid, uuid) to authenticated;

create or replace function public.validate_profile_default_league()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.default_league_id is not null
    and not public.is_active_league_member(new.default_league_id, new.id)
  then
    raise exception 'Default league requires an active membership';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_validate_default_league on public.profiles;
create trigger profiles_validate_default_league
before insert or update of default_league_id on public.profiles
for each row
execute function public.validate_profile_default_league();

revoke all on function public.validate_profile_default_league() from public;

alter table public.leagues enable row level security;
alter table public.league_memberships enable row level security;
alter table public.league_invites enable row level security;

drop policy if exists "Members can read their leagues" on public.leagues;
create policy "Members can read their leagues"
on public.leagues
for select
using (
  public.is_active_league_member(id)
  or public.is_platform_admin()
);

drop policy if exists "League admins can update their leagues" on public.leagues;
create policy "League admins can update their leagues"
on public.leagues
for update
using (public.is_league_admin(id))
with check (public.is_league_admin(id));

drop policy if exists "Members can read league memberships" on public.league_memberships;
create policy "Members can read league memberships"
on public.league_memberships
for select
using (
  public.is_active_league_member(league_id)
  or public.is_platform_admin()
);

drop policy if exists "League admins can manage memberships" on public.league_memberships;
create policy "League admins can manage memberships"
on public.league_memberships
for update
using (public.is_league_admin(league_id))
with check (public.is_league_admin(league_id));

drop policy if exists "League admins can read invites" on public.league_invites;
create policy "League admins can read invites"
on public.league_invites
for select
using (public.is_league_admin(league_id));

drop policy if exists "League admins can manage invites" on public.league_invites;
create policy "League admins can manage invites"
on public.league_invites
for all
using (public.is_league_admin(league_id))
with check (public.is_league_admin(league_id));

drop function if exists public.create_league_for_current_user(text);
drop function if exists public.create_league_for_current_user(text, text);
drop function if exists public.create_league_for_current_user(text, text, uuid);
drop function if exists public.create_league_for_current_user(text, text, uuid, text);

create or replace function public.create_league_for_current_user(
  league_name text,
  base_competition_code text,
  request_creation_key uuid,
  initial_season_name text default null
)
returns table (league_id uuid, season_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  new_league_id uuid;
  new_season_id uuid;
  new_invite_code text;
  competition_name text;
  competition_external_id text;
  current_provider_season text;
  season_start_year integer;
  season_label text;
begin
  if caller_id is null or not exists (
    select 1 from public.profiles
    where id = caller_id and status = 'approved'
  ) then
    raise exception 'An approved account is required';
  end if;

  if request_creation_key is null then
    raise exception 'A creation key is required';
  end if;

  select
    league.id,
    season.id,
    invite.code
  into
    new_league_id,
    new_season_id,
    new_invite_code
  from public.leagues league
  join public.seasons season
    on season.league_id = league.id
    and season.status = 'active'
  join public.league_invites invite
    on invite.league_id = league.id
    and invite.disabled_at is null
  where league.created_by = caller_id
    and league.creation_key = request_creation_key
  order by invite.created_at desc
  limit 1;

  if new_league_id is not null then
    return query select new_league_id, new_season_id, new_invite_code;
    return;
  end if;

  league_name := btrim(league_name);
  if char_length(league_name) < 2 or char_length(league_name) > 80 then
    raise exception 'League name must be between 2 and 80 characters';
  end if;

  base_competition_code := upper(btrim(base_competition_code));
  select supported.name, supported.external_id
  into competition_name, competition_external_id
  from (
    values
      ('PL', 'Premier League', '2021'),
      ('PD', 'La Liga', '2014'),
      ('SA', 'Serie A', '2019'),
      ('BL1', 'Bundesliga', '2002'),
      ('FL1', 'Ligue 1', '2015')
  ) as supported(code, name, external_id)
  where supported.code = base_competition_code;

  if competition_name is null then
    raise exception 'Unsupported base competition';
  end if;

  select fixture.provider_season
  into current_provider_season
  from public.external_fixtures fixture
  where fixture.provider = 'football_data'
    and fixture.external_competition_code = base_competition_code
    and fixture.provider_season is not null
  order by
    case when fixture.kickoff_at >= now() then 0 else 1 end,
    abs(extract(epoch from (fixture.kickoff_at - now())))
  limit 1;

  season_start_year :=
    case
      when extract(month from current_date) >= 7
        then extract(year from current_date)::integer
      else extract(year from current_date)::integer - 1
    end;
  season_label :=
    season_start_year::text || '/' ||
    right((season_start_year + 1)::text, 2);

  initial_season_name := nullif(btrim(initial_season_name), '');
  if initial_season_name is not null and (
    char_length(initial_season_name) < 2 or
    char_length(initial_season_name) > 100
  ) then
    raise exception 'Current season name must be between 2 and 100 characters';
  end if;

  insert into public.leagues (
    name,
    created_by,
    default_base_provider,
    default_base_competition_code,
    default_base_competition_name,
    default_base_competition_external_id,
    creation_key
  )
  values (
    league_name,
    caller_id,
    'football_data',
    base_competition_code,
    competition_name,
    competition_external_id,
    request_creation_key
  )
  returning id into new_league_id;

  insert into public.league_memberships (
    league_id, user_id, role, status
  )
  values (new_league_id, caller_id, 'league_admin', 'active');

  loop
    new_invite_code :=
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (
      select 1 from public.league_invites where code = new_invite_code
    );
  end loop;

  insert into public.league_invites (league_id, code, created_by)
  values (new_league_id, new_invite_code, caller_id);

  insert into public.seasons (
    league_id,
    name,
    description,
    season_type,
    status,
    show_in_archive,
    base_provider,
    base_competition_code,
    base_competition_name,
    base_competition_external_id,
    provider_season,
    fixture_import_enabled,
    result_sync_enabled,
    created_by
  )
  values (
    new_league_id,
    coalesce(initial_season_name, competition_name || ' ' || season_label),
    'Created with league ' || league_name,
    'standard',
    'active',
    true,
    'football_data',
    base_competition_code,
    competition_name,
    competition_external_id,
    current_provider_season,
    true,
    true,
    caller_id
  )
  returning id into new_season_id;

  insert into public.gameweeks (
    season_id,
    gameweek_number,
    name,
    fixture_picker_id
  )
  select
    new_season_id,
    gameweek_number,
    'Gameweek ' || gameweek_number,
    caller_id
  from generate_series(1, 38) as gameweek_number;

  return query select new_league_id, new_season_id, new_invite_code;
end;
$$;

create or replace function public.join_league_by_code(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  selected_invite public.league_invites%rowtype;
  already_active boolean;
begin
  if caller_id is null or not exists (
    select 1 from public.profiles
    where id = caller_id and status = 'approved'
  ) then
    raise exception 'An approved account is required';
  end if;

  select invite.*
  into selected_invite
  from public.league_invites invite
  join public.leagues league on league.id = invite.league_id
  where upper(invite.code) = upper(btrim(invite_code))
    and league.status = 'active'
    and invite.disabled_at is null
    and (invite.expires_at is null or invite.expires_at > now())
    and (invite.max_uses is null or invite.use_count < invite.max_uses)
  for update of invite;

  if not found then
    raise exception 'Invite code is invalid, expired, disabled, or full';
  end if;

  select exists (
    select 1
    from public.league_memberships
    where league_id = selected_invite.league_id
      and user_id = caller_id
      and status = 'active'
  )
  into already_active;

  insert into public.league_memberships (
    league_id,
    user_id,
    role,
    status,
    invited_by,
    joined_at,
    removed_at,
    removed_by
  )
  values (
    selected_invite.league_id,
    caller_id,
    'player',
    'active',
    selected_invite.created_by,
    now(),
    null,
    null
  )
  on conflict (league_id, user_id) do update
  set
    status = 'active',
    joined_at = now(),
    invited_by = excluded.invited_by,
    removed_at = null,
    removed_by = null;

  if not already_active then
    update public.league_invites
    set use_count = use_count + 1
    where id = selected_invite.id;
  end if;

  return selected_invite.league_id;
end;
$$;

revoke all on function public.create_league_for_current_user(text, text, uuid, text) from public;
revoke all on function public.join_league_by_code(text) from public;
grant execute on function public.create_league_for_current_user(text, text, uuid, text) to authenticated;
grant execute on function public.join_league_by_code(text) to authenticated;

grant usage on schema public to authenticated, service_role;

grant select on table public.leagues to authenticated;
grant select on table public.league_memberships to authenticated;
grant select on table public.league_invites to authenticated;

grant select, insert, update, delete on table public.leagues to service_role;
grant select, insert, update, delete on table public.league_memberships to service_role;
grant select, insert, update, delete on table public.league_invites to service_role;

notify pgrst, 'reload schema';

commit;
