begin;

create or replace function public.require_complete_entry_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fixture_selection_count integer;
  fixture_category_count integer;
begin
  if new.submitted_at is null then
    return new;
  end if;

  select count(*), count(distinct category)
  into fixture_selection_count, fixture_category_count
  from public.entry_selections
  where entry_id = new.id
    and category in (
      'home_win',
      'away_win',
      'draw',
      'team_win',
      'team_lose',
      'team_score',
      'clean_sheet'
    );

  if new.total_goals_prediction is null
    or fixture_selection_count <> 7
    or fixture_category_count <> 7
  then
    raise exception using
      errcode = '23514',
      message = 'Entry must have all seven fixture selections and Total Goals before submission';
  end if;

  return new;
end;
$$;

drop trigger if exists entries_require_complete_submission on public.entries;
create trigger entries_require_complete_submission
before insert or update of submitted_at, total_goals_prediction
on public.entries
for each row
execute function public.require_complete_entry_submission();

revoke all on function public.require_complete_entry_submission() from public;

commit;
