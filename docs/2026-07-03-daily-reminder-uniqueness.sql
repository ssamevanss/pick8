begin;

alter table public.prediction_reminders
add column if not exists reminder_date date not null default current_date;

alter table public.prediction_reminders
drop constraint if exists prediction_reminders_unique_gameweek_user_type;

alter table public.prediction_reminders
drop constraint if exists prediction_reminders_unique_gameweek_user_type_date;

alter table public.prediction_reminders
add constraint prediction_reminders_unique_gameweek_user_type_date
unique (gameweek_id, user_id, reminder_type, reminder_date);

create index if not exists prediction_reminders_type_date_idx
on public.prediction_reminders (reminder_type, reminder_date);

commit;
