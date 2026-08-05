begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null,
  is_admin boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_check
    check (
      char_length(btrim(display_name)) between 1 and 80
    )
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_display_name text;
begin
  profile_display_name := left(
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
      'Player'
    ),
    80
  );

  insert into public.profiles (
    id,
    email,
    display_name
  )
  values (
    new.id,
    new.email,
    profile_display_name
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = excluded.display_name;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public;
grant execute on function public.handle_new_user() to supabase_auth_admin;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

revoke all on function public.set_updated_at() from public;

create or replace function public.is_pick8_admin(
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = check_user_id
      and is_admin = true
      and is_active = true
  );
$$;

revoke all on function public.is_pick8_admin(uuid) from public;
grant execute on function public.is_pick8_admin(uuid)
to authenticated, service_role;

alter table public.profiles enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists "Active admins can read all profiles" on public.profiles;
create policy "Active admins can read all profiles"
on public.profiles
for select
to authenticated
using (public.is_pick8_admin());

drop policy if exists "Active admins can update profiles" on public.profiles;
create policy "Active admins can update profiles"
on public.profiles
for update
to authenticated
using (public.is_pick8_admin())
with check (public.is_pick8_admin());

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (
  display_name,
  is_admin,
  is_active,
  updated_at
) on table public.profiles to authenticated;

grant select, insert, update, delete on table public.profiles to service_role;

commit;
