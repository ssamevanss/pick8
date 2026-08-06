create unique index competitions_season_matchday_range_unique
on public.competitions (season_id, start_matchday, end_matchday);
