// Optional isolated PostgreSQL verification, without project dependency changes:
// PICK8_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node --test tests/pick8-cron-executions-migration.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const { PGlite } = await import(pathToFileURL(process.env.PICK8_PGLITE_MODULE).href);
const db = new PGlite();
// Supabase's service_role bypasses RLS; the table has RLS and no policies, so only it can reach the data.
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;`);
// Supabase grants every new public table to anon/authenticated/service_role through default privileges; the migration
// must close that off itself, so reproduce the default before applying it.
await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
await db.exec(readFileSync(new URL('../supabase/migrations/20261103000000_pick8_cron_executions.sql', import.meta.url), 'utf8'));

const as = async (role, sql, params) => {
  await db.exec(`set role ${role}`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};

await test('the table is created empty with RLS enabled', async () => {
  const { rows } = await db.query(`select relrowsecurity from pg_class where oid = 'public.pick8_cron_executions'::regclass`);
  assert.equal(rows[0].relrowsecurity, true);
  assert.equal((await db.query('select count(*)::int as n from public.pick8_cron_executions')).rows[0].n, 0);
});
await test('service_role can record, finish and read a run; defaults are a running row', async () => {
  const inserted = await as('service_role', `insert into public.pick8_cron_executions(job) values ('sync-results') returning id, outcome, finished_at`);
  assert.equal(inserted.rows[0].outcome, 'running');
  assert.equal(inserted.rows[0].finished_at, null);
  await as('service_role', `update public.pick8_cron_executions set outcome='failure', finished_at=now(), duration_ms=12, error='boom', summary='{"failures":1}' where id=$1`, [inserted.rows[0].id]);
  const row = (await as('service_role', 'select * from public.pick8_cron_executions where id=$1', [inserted.rows[0].id])).rows[0];
  assert.equal(row.outcome, 'failure');
  assert.deepEqual(row.summary, { failures: 1 });
});
await test('anon and authenticated players cannot read or write execution history', async () => {
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(as(role, 'select * from public.pick8_cron_executions'), /permission denied/);
    await assert.rejects(as(role, `insert into public.pick8_cron_executions(job) values ('sync-results')`), /permission denied/);
    await assert.rejects(as(role, `update public.pick8_cron_executions set error='x'`), /permission denied/);
  }
});
await test('no policies exist and no ordinary role holds any table privilege (default privileges are revoked)', async () => {
  assert.equal((await db.query(`select count(*)::int as n from pg_policies where tablename='pick8_cron_executions'`)).rows[0].n, 0);
  for (const role of ['anon', 'authenticated', 'public']) {
    for (const privilege of ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) {
      const { rows } = await db.query(`select has_table_privilege($1, 'public.pick8_cron_executions', $2) as allowed`, [role, privilege]);
      assert.equal(rows[0].allowed, false, `${role} must not hold ${privilege}`);
    }
  }
  for (const privilege of ['select', 'insert', 'update']) {
    assert.equal((await db.query(`select has_table_privilege('service_role', 'public.pick8_cron_executions', $1) as allowed`, [privilege])).rows[0].allowed, true);
  }
});
await test('players cannot delete or truncate either, and a policy-less table denies by default even if granted', async () => {
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(as(role, 'delete from public.pick8_cron_executions'), /permission denied/);
    await assert.rejects(as(role, 'truncate public.pick8_cron_executions'), /permission denied/);
  }
  // Defence in depth: even with a table grant, RLS without policies returns nothing and rejects writes.
  await db.exec('grant select, insert on public.pick8_cron_executions to authenticated');
  try {
    assert.equal((await as('authenticated', 'select * from public.pick8_cron_executions')).rows.length, 0);
    await assert.rejects(as('authenticated', `insert into public.pick8_cron_executions(job) values ('sync-results')`), /row-level security/);
  } finally {
    await db.exec('revoke all on public.pick8_cron_executions from authenticated');
  }
});
await test('constraints reject unknown jobs/outcomes, over-long errors, and finished rows without a finish time', async () => {
  const bad = (sql) => assert.rejects(as('service_role', sql), /violates check constraint/);
  await bad(`insert into public.pick8_cron_executions(job) values ('send-prediction-reminders')`);
  await bad(`insert into public.pick8_cron_executions(job, outcome, finished_at) values ('sync-results', 'ok', now())`);
  await bad(`insert into public.pick8_cron_executions(job, outcome, finished_at, error) values ('sync-results', 'failure', now(), '${'x'.repeat(301)}')`);
  await bad(`insert into public.pick8_cron_executions(job, outcome) values ('sync-results', 'success')`);
});
await test('the per-job recency index exists for the health queries', async () => {
  const { rows } = await db.query(`select indexname from pg_indexes where tablename='pick8_cron_executions'`);
  assert.ok(rows.some((r) => r.indexname === 'pick8_cron_executions_job_started_idx'));
});
await test('health queries use the indexes on a year of sync-results history (no sequential scan)', async () => {
  await db.exec(`insert into public.pick8_cron_executions(job, started_at, finished_at, outcome, duration_ms)
    select 'sync-results', timestamptz '2026-01-01' + n * interval '5 minutes', timestamptz '2026-01-01' + n * interval '5 minutes', 'no_op', 100
    from generate_series(0, 105119) n;
    insert into public.pick8_cron_executions(job, started_at, finished_at, outcome, duration_ms)
    select j, d, d, 'success', 100 from unnest(array['sync-fixtures','reconcile-results']) j, generate_series(timestamptz '2026-01-01', timestamptz '2026-12-31', interval '1 day') d;
    analyze public.pick8_cron_executions;`);
  const plan = async (sql) => (await db.query(`explain ${sql}`)).rows.map((r) => r['QUERY PLAN']).join('\n');
  const recent = await plan(`select * from public.pick8_cron_executions where job='sync-results' order by started_at desc limit 10`);
  const success = await plan(`select started_at from public.pick8_cron_executions where job='sync-results' and outcome in ('success','no_op') order by started_at desc limit 1`);
  const first = await plan(`select started_at from public.pick8_cron_executions order by started_at asc limit 1`);
  for (const [name, text] of [['recent', recent], ['last success', success], ['first run', first]]) {
    assert.doesNotMatch(text, /Seq Scan/, `${name}: ${text}`);
    assert.match(text, /pick8_cron_executions_(job_started|started)_idx/, name);
  }
  const { rows } = await db.query(`select pg_total_relation_size('public.pick8_cron_executions') as bytes, (select count(*) from public.pick8_cron_executions)::int as n`);
  console.log(`# ${rows[0].n} rows, ${(rows[0].bytes / 1048576).toFixed(1)} MiB including indexes`);
});
await db.close();
