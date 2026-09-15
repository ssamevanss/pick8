// Optional isolated PostgreSQL verification, without project dependency changes:
// PICK8_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node --test tests/pick8-sync-migration.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const { PGlite } = await import(pathToFileURL(process.env.PICK8_PGLITE_MODULE).href);
const db = new PGlite();
const season = '00000000-0000-0000-0000-000000000001';
const matchday = '00000000-0000-0000-0000-000000000002';
const otherMatchday = '00000000-0000-0000-0000-000000000003';
const fixture = '00000000-0000-0000-0000-000000000004';
const entry = '00000000-0000-0000-0000-000000000005';
const selection = '00000000-0000-0000-0000-000000000006';

await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role', true) $$;
select set_config('request.jwt.claim.role', 'service_role', false);
create table public.seasons (id uuid primary key, name text, provider_season integer, is_active boolean default false, updated_at timestamptz default now());
create table public.matchdays (id uuid primary key, season_id uuid references public.seasons on delete cascade,
  matchday_number integer, fixture_sync_mode text default 'provider', is_accelerated_test boolean default false,
  status text default 'upcoming', opens_at timestamptz, locks_at timestamptz, updated_at timestamptz default now());
create table public.fixtures (id uuid primary key, matchday_id uuid references public.matchdays on delete cascade,
  external_fixture_id text, home_team_id integer, away_team_id integer, home_team_name text, away_team_name text,
  home_team_crest_url text, away_team_crest_url text, kickoff_at timestamptz, status text,
  home_score integer, away_score integer, last_synced_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.entries (id uuid primary key, matchday_id uuid references public.matchdays on delete cascade,
  submitted_at timestamptz, total_goals_prediction integer, calculated_score integer, score_calculated_at timestamptz, updated_at timestamptz default now());
create table public.entry_selections (id uuid primary key, entry_id uuid references public.entries on delete cascade,
  fixture_id uuid references public.fixtures, category text, selected_team_side text, points_awarded integer, is_correct boolean, updated_at timestamptz default now());
insert into public.seasons(id,name,provider_season,is_active) values ('${season}', '2026/27', 2026, true);
insert into public.matchdays(id,season_id,matchday_number) values ('${matchday}','${season}',5), ('${otherMatchday}','${season}',6);
`);
// Include the real pre-existing manual isolation/deadline triggers, not their
// historical data repair block, to test interaction with the new migration.
const deadlines = readFileSync(new URL('../supabase/migrations/20260813000000_repair_manual_matchday_deadlines.sql', import.meta.url), 'utf8').split('do $$')[0];
await db.exec(deadlines + '\ncommit;');
await db.exec(readFileSync(new URL('../supabase/migrations/20260913000000_pick8_sync_fingerprints.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/20260914120012_transactional_pick8_scoring.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/20260915074746_pick8_due_state_model.sql', import.meta.url), 'utf8'));
const state = async () => (await db.query('select * from public.matchdays where id=$1', [matchday])).rows[0];
const clean = async () => db.exec(`update public.matchdays set sync_pending=false, fixture_application_pending=false, scoring_pending=false;
  update public.seasons set competition_refresh_pending=false;`);

await test('migration bootstraps existing rows without scheduling a season-wide replay', async () => {
  const row = await state();
  assert.equal(row.sync_pending, false);
  assert.equal(row.scoring_pending, false);
  assert.equal(row.applied_fixture_fingerprint, null);
});
await test('fixture insertion invalidates sync/scoring and coexists with deadline triggers', async () => {
  await db.exec(`insert into public.fixtures(id,matchday_id,external_fixture_id,kickoff_at,status,home_score,away_score)
    values ('${fixture}','${matchday}','123','2026-09-13T10:00:00Z','finished',2,1);`);
  const row = await state();
  assert.equal(row.sync_pending, true);
  assert.equal(row.scoring_pending, true);
  assert.ok(row.locks_at);
});
await test('timestamp-only checks do not invalidate content or scoring', async () => {
  await clean(); const before = await state();
  await db.exec(`update public.fixtures set last_synced_at=now(),updated_at=now() where id='${fixture}';
    update public.matchdays set last_upstream_check_at=now() where id='${matchday}';`);
  const after = await state();
  assert.equal(after.sync_revision, before.sync_revision);
  assert.equal(after.scoring_revision, before.scoring_revision);
  assert.equal(after.sync_pending, false);
});
await test('a local fixture correction prevents a stale revision acknowledgement', async () => {
  const before = await state();
  await db.exec(`update public.fixtures set home_score=3 where id='${fixture}';`);
  const result = await db.query('update public.matchdays set sync_pending=false where id=$1 and sync_revision=$2 returning id', [matchday, before.sync_revision]);
  assert.equal(result.rows.length, 0);
  assert.equal((await state()).scoring_pending, true);
});
await test('entry and selection inputs invalidate state; normal score output writes do not', async () => {
  await db.exec(`insert into public.entries(id,matchday_id,submitted_at,total_goals_prediction) values ('${entry}','${matchday}',now(),30);
    insert into public.entry_selections(id,entry_id,fixture_id,category,selected_team_side) values ('${selection}','${entry}','${fixture}','home_win','home');`);
  assert.equal((await state()).scoring_pending, true);
  await clean(); const before = await state();
  await db.exec(`update public.entries set calculated_score=12,score_calculated_at=now(),updated_at=now() where id='${entry}';
    update public.entry_selections set points_awarded=3,is_correct=true,updated_at=now() where id='${selection}';`);
  assert.equal((await state()).scoring_revision, before.scoring_revision);
  await db.exec(`update public.entry_selections set category='draw' where id='${selection}';`);
  assert.equal((await state()).scoring_pending, true);
  assert.equal((await state()).fixture_application_pending, false);
  await clean();
  await db.exec(`update public.entries set total_goals_prediction=31 where id='${entry}';`);
  assert.equal((await state()).scoring_pending, true);
  assert.equal((await state()).fixture_application_pending, false);
});

await test('bounded discovery returns one local recovery row without fixture payloads', async () => {
  const result = (await db.query(`select public.discover_pick8_due_work('results','2026-09-13T12:00:00Z',12) as work`)).rows[0].work;
  assert.equal(result.season.id, season);
  assert.equal(result.matchdays.length, 1);
  assert.equal(result.matchdays[0].localScoringRecoveryDue, true);
  assert.equal('fixtures' in result.matchdays[0], false);
});
await test('authenticated local edits invalidate state but cannot forge clean metadata', async () => {
  await clean();
  await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");
  await db.exec(`update public.fixtures set away_score=2 where id='${fixture}';`);
  assert.equal((await state()).sync_pending, true);
  await assert.rejects(db.exec(`update public.matchdays set sync_pending=false where id='${matchday}';`), /server-managed/);
  await assert.rejects(db.exec(`update public.matchdays set applied_fixture_fingerprint='fake' where id='${matchday}';`), /server-managed/);
  await db.exec(`update public.matchdays set status='scoring' where id='${matchday}';`);
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
});
await test('status changes retain sync/competition work without invalidating scorer input revisions', async () => {
  await clean(); const before = await state();
  await db.exec(`update public.matchdays set status='completed' where id='${matchday}';`);
  const after = await state();
  assert.equal(after.scoring_revision, before.scoring_revision);
  assert.equal(after.sync_pending, false);
  assert.equal((await db.query('select competition_refresh_pending from public.seasons')).rows[0].competition_refresh_pending, true);
});
await test('fixture movement invalidates both matchdays', async () => {
  await db.exec(`delete from public.entry_selections where id='${selection}';`);
  await clean();
  await db.exec(`update public.fixtures set matchday_id='${otherMatchday}' where id='${fixture}';`);
  const rows = (await db.query('select sync_pending,scoring_pending from public.matchdays')).rows;
  assert.equal(rows.every(row => row.sync_pending && row.scoring_pending), true);
});
await test('entry deletion and fixture deletion retain recovery work', async () => {
  await clean(); await db.exec(`delete from public.entries where id='${entry}';`);
  assert.equal((await state()).sync_pending, false);
  assert.equal((await state()).scoring_pending, true);
  await clean(); await db.exec(`delete from public.fixtures where id='${fixture}';`);
  assert.equal((await db.query('select sync_pending from public.matchdays where id=$1', [otherMatchday])).rows[0].sync_pending, true);
});
await test('competition checkpoint commit is readable and a stale acknowledgement cannot clear newer work', async () => {
  await db.exec(`update public.seasons set competition_refresh_pending=true where id='${season}'`);
  const before = (await db.query('select * from public.seasons where id=$1', [season])).rows[0];
  // Ignore the write response as though the gateway lost it after commit.
  await db.query('update public.seasons set competition_refresh_pending=false, competition_refresh_after=$3 where id=$1 and competition_revision=$2',
    [season, before.competition_revision, '2026-09-14T12:00:00Z']);
  const committed = (await db.query('select * from public.seasons where id=$1', [season])).rows[0];
  assert.equal(committed.competition_revision, before.competition_revision);
  assert.equal(committed.competition_refresh_pending, false);
  assert.equal(new Date(committed.competition_refresh_after).toISOString(), '2026-09-14T12:00:00.000Z');
  await db.exec(`update public.matchdays set status='open' where id='${matchday}'`);
  const stale = await db.query('update public.seasons set competition_refresh_pending=false where id=$1 and competition_revision=$2 returning id', [season, before.competition_revision]);
  assert.equal(stale.rows.length, 0);
  const newer = (await db.query('select * from public.seasons where id=$1', [season])).rows[0];
  assert.equal(newer.competition_refresh_pending, true);
  assert.ok(newer.competition_revision > before.competition_revision);
});
await db.close();
