begin;

-- Durable history of scheduled-automation attempts. One row per authenticated invocation of
-- sync-results, sync-fixtures or reconcile-results. `outcome` is derived from the response body
-- (business failures return HTTP 200 with ok:false), not from the HTTP status.
-- Written and read only by server code with the service role; players have no access.
create table public.pick8_cron_executions (
  id uuid primary key default gen_random_uuid(),
  job text not null check (job in ('sync-results', 'sync-fixtures', 'reconcile-results')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null default 'running' check (outcome in ('running', 'success', 'no_op', 'failure')),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error text check (error is null or char_length(error) <= 300),
  summary jsonb not null default '{}'::jsonb,
  check (outcome = 'running' or finished_at is not null)
);

create index pick8_cron_executions_job_started_idx
on public.pick8_cron_executions (job, started_at desc);

create index pick8_cron_executions_started_idx
on public.pick8_cron_executions (started_at);

alter table public.pick8_cron_executions enable row level security;

revoke all on table public.pick8_cron_executions from public, anon, authenticated;
grant select, insert, update on table public.pick8_cron_executions to service_role;

commit;
