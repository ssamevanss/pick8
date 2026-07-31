begin;

-- Admin approval queues and approved-user eligibility checks.
create index if not exists profiles_status_idx
on public.profiles (status);

-- Common ordered fixture reads for gameplay and administration.
create index if not exists fixtures_gameweek_kickoff_idx
on public.fixtures (gameweek_id, kickoff_at);

-- Prediction visibility, scoring, and picker-lock checks begin with fixture ids.
create index if not exists predictions_fixture_idx
on public.predictions (fixture_id);

-- Joker reads are restricted to non-refunded rows in both page and scoring paths.
create index if not exists joker_usage_season_user_active_idx
on public.joker_usage (season_id, user_id)
where refunded_at is null;

create index if not exists joker_usage_fixture_active_idx
on public.joker_usage (fixture_id, user_id)
where refunded_at is null;

-- Leaderboards are read in rank order within one season.
create index if not exists leaderboard_entries_season_rank_idx
on public.leaderboard_entries (season_id, rank);

-- The header groups unread rows first, then orders each group by recency.
create index if not exists user_notifications_user_read_updated_idx
on public.user_notifications (user_id, read_at, updated_at desc);

-- Multi-season jobs start from active provider-backed seasons.
create index if not exists seasons_active_provider_idx
on public.seasons (status, base_provider)
where status = 'active';

commit;
