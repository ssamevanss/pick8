-- User-submitted bug reports.
-- Safe to run more than once.

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  user_email text,
  user_name text,
  page_url text,
  user_agent text,
  message text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  constraint bug_reports_status_check
    check (status in ('open', 'reviewed', 'closed'))
);

create index if not exists bug_reports_status_created_idx
on public.bug_reports (status, created_at desc);

create index if not exists bug_reports_user_created_idx
on public.bug_reports (user_id, created_at desc);

alter table public.bug_reports enable row level security;

drop policy if exists "Authenticated users can insert own bug reports"
on public.bug_reports;

create policy "Authenticated users can insert own bug reports"
on public.bug_reports
for insert
with check (user_id = auth.uid());

drop policy if exists "Approved admins can read bug reports"
on public.bug_reports;

create policy "Approved admins can read bug reports"
on public.bug_reports
for select
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.status = 'approved'
  )
);

drop policy if exists "Approved admins can update bug reports"
on public.bug_reports;

create policy "Approved admins can update bug reports"
on public.bug_reports
for update
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.status = 'approved'
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and profiles.status = 'approved'
  )
);

grant insert on public.bug_reports to authenticated;
grant select, update on public.bug_reports to authenticated;
grant select, insert, update, delete on public.bug_reports to service_role;
