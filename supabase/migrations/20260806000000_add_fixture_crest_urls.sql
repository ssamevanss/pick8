alter table public.fixtures
  add column home_team_crest_url text,
  add column away_team_crest_url text,
  add constraint fixtures_home_team_crest_url_https_check
    check (home_team_crest_url is null or home_team_crest_url like 'https://%'),
  add constraint fixtures_away_team_crest_url_https_check
    check (away_team_crest_url is null or away_team_crest_url like 'https://%');
