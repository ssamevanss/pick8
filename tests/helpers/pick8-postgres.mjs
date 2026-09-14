import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

export const root = resolve(import.meta.dirname, '../..');
export function referenceScorer() {
  const native = createRequire(join(root, 'package.json'));
  const modules = new Map();
  function load(file) {
    const path = resolve(root, file);
    if (modules.has(path)) return modules.get(path);
    const loadedModule = { exports: {} }; modules.set(path, loadedModule.exports);
    const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const require = id => {
      if (id === 'server-only') return {};
      if (id === '@/utils/supabase/admin') return { createAdminClient() { throw Error('Reference scorer cannot access database'); } };
      return id.startsWith('@/') ? load(id.slice(2) + '.ts') : native(id);
    };
    runInNewContext(source, { module: loadedModule, exports: loadedModule.exports, require, Date, Map, Set, console, performance, crypto: globalThis.crypto });
    return loadedModule.exports;
  }
  return load('utils/pick8-scoring.ts');
}

export async function createTestDatabase() {
  // No production URL is accepted. Always initialise a fresh localhost cluster.
  const dependencies = process.env.PICK8_PG_TEST_DEPENDENCIES;
  if (!dependencies) throw Error('Set PICK8_PG_TEST_DEPENDENCIES to a directory containing embedded-postgres@17.6.0-beta.15 and pg.');
  const native = createRequire(join(resolve(dependencies), 'package.json'));
  const { default: EmbeddedPostgres } = await import(pathToFileURL(native.resolve('embedded-postgres')).href);
  const { Client } = native('pg');
  const directory = mkdtempSync(join(tmpdir(), 'pick8-scoring-pg-'));
  const port = Number(process.env.PICK8_PG_TEST_PORT ?? 55439);
  const logs = [];
  const cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'data'), port,
    user: 'postgres', password: 'isolated-tests-only', persistent: false,
    postgresFlags: ['-h', '127.0.0.1', '-k', directory], onLog(message) { logs.push(message); }, onError(message) { logs.push(String(message)); } });
  try { await cluster.initialise(); await cluster.start(); }
  catch (error) { throw new Error(`${error}: ${logs.join("\n")}`); }
  const clients = [];
  async function connect(service = true) {
    const client = new Client({ host: '127.0.0.1', port, user: 'postgres', password: 'isolated-tests-only', database: 'postgres' });
    await client.connect(); clients.push(client);
    if (service) await client.query("set role service_role; set request.jwt.claim.role = 'service_role'; set statement_timeout = '5s'");
    return client;
  }
  const admin = await connect(false);
  await admin.query(`create role anon; create role authenticated; create role service_role bypassrls;
    create role supabase_auth_admin; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    grant usage on schema public,auth to service_role,authenticated,anon;
    set request.jwt.claim.role = 'service_role';`);
  for (const name of readdirSync(join(root, 'supabase/migrations')).filter(x => x.endsWith('.sql')).sort()) {
    // These two historical data repairs assert specific production UUIDs. Skip
    // only their data operations; all schema/functions/triggers are applied.
    if (name.startsWith('20260812000000')) continue;
    let sql = readFileSync(join(root, 'supabase/migrations', name), 'utf8');
    if (name.startsWith('20260813000000')) sql = sql.split('do $$')[0] + '\ncommit;';
    if (name.endsWith('_transactional_pick8_scoring.sql')) {
      // Read-only production catalog snapshot: includes the additional deployed
      // submission trigger absent from migration history. Test actual deployed
      // functions/trigger ordering before applying the new migration.
      const deployed = JSON.parse(readFileSync(join(root, 'tests/fixtures/pick8-deployed-triggers-20260914.json'), 'utf8'));
      for (const definition of deployed.functions) await admin.query(definition);
      for (const trigger of deployed.triggers) {
        await admin.query(`drop trigger if exists "${trigger.name}" on public."${trigger.table}"`);
        await admin.query(trigger.definition);
      }
    }
    try { await admin.query(sql); } catch (error) { await cluster.stop(); throw new Error(`${name}: ${error.message}`, { cause: error }); }
  }
  return { admin, connect, async close() { await Promise.all(clients.map(c => c.end())); await cluster.stop(); } };
}

export const categories = ['home_win','away_win','draw','team_win','team_lose','team_score','clean_sheet'];
export async function seed(db, { entries = 26, status = 'finished', home = 2, away = 1, future = false, manual = false, accelerated = false, draft = false } = {}) {
  await db.query('truncate public.seasons, auth.users cascade');
  const season = (await db.query("insert into public.seasons(name,provider_season,is_active) values('2026/27',2026,true) returning id")).rows[0].id;
  const matchday = (await db.query("insert into public.matchdays(season_id,matchday_number,status,fixture_sync_mode,is_accelerated_test) values($1,4,'scoring',$2,$3) returning id", [season, manual ? 'manual' : 'provider', accelerated])).rows[0].id;
  const fixtures = (await db.query(`insert into public.fixtures(matchday_id,external_fixture_id,home_team_name,away_team_name,kickoff_at,status,home_score,away_score)
    select $1,'test-'||i,'Home '||i,'Away '||i,now() + $5::interval,$2,$3,$4 from generate_series(1,10) i returning *`,
    [matchday, status, home, away, future ? '1 day' : '-1 day'])).rows;
  const players = (await db.query(`insert into auth.users(id,email) select gen_random_uuid(),'player'||i||'@test.invalid' from generate_series(1,$1::int) i returning id`, [entries])).rows;
  for (const player of players) {
    const entry = (await db.query('insert into public.entries(user_id,matchday_id,total_goals_prediction) values($1,$2,$3) returning id', [player.id, matchday, Math.min(200, (home ?? 0)*10+(away ?? 0)*10)])).rows[0].id;
    await db.query(`insert into public.entry_selections(entry_id,fixture_id,category,selected_team_side)
      select $1,f,c,case when c='draw' then null when c='away_win' then 'away' else 'home' end
      from unnest($2::uuid[],$3::text[]) as t(f,c)`, [entry, fixtures.slice(0,7).map(f=>f.id), categories]);
    if (!draft) await db.query('update public.entries set submitted_at=now() where id=$1', [entry]);
  }
  return { season, matchday, fixtures };
}

export async function snapshot(db, id) {
  return (await db.query(`select jsonb_build_object('matchday',to_jsonb(m),
    'fixtures',(select coalesce(jsonb_agg(to_jsonb(f) order by id),'[]') from public.fixtures f where matchday_id=m.id),
    'entries',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from public.entries e where matchday_id=m.id),
    'selections',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.entry_selections s join public.entries e on e.id=s.entry_id where e.matchday_id=m.id)) as snapshot
    from public.matchdays m where m.id=$1`, [id])).rows[0].snapshot;
}
export async function score(db, ids, revision, accelerated = false) {
  return (await db.query('select public.score_pick8_matchday($1,$2,$3,$4) as result', [ids.season, ids.matchday, revision, accelerated])).rows[0].result;
}
