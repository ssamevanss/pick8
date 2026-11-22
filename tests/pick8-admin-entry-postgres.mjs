// Isolated database only: PICK8_PG_TEST_DEPENDENCIES=/path/to/deps node --test tests/pick8-admin-entry-postgres.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, seed, snapshot, score, categoriesV2 } from './helpers/pick8-postgres.mjs';

const cluster = await createTestDatabase();
const db = await cluster.connect();
const admin = cluster.admin;
async function person(isAdmin = false) {
  const id = (await admin.query("insert into auth.users(id,email) values(gen_random_uuid(),gen_random_uuid()||'@test.invalid') returning id")).rows[0].id;
  await admin.query('update public.profiles set is_active=true,is_admin=$2,pick8_participation_active=true where id=$1', [id,isAdmin]);
  return id;
}
async function setup(options = {}) {
  const ids = await seed(admin, { entries: 0, rulesVersion: 2, ...options });
  return { ...ids, actor: await person(true), player: await person(), picks: categoriesV2.map((category,i) => ({ category, fixture_id: ids.fixtures[i].id, selected_team_side: ['draw','btts'].includes(category) ? null : category === 'away_win' ? 'away' : 'home' })) };
}
async function save(ids, changes = {}, client = db) {
  const input = { actor: ids.actor, player: ids.player, expected: null, reason: 'Authorised test administrative entry', late: true, matchday: ids.matchday, intent: 'submit', goals: 28, picks: ids.picks, ...changes };
  return (await client.query('select public.admin_save_pick8_entry($1,$2,$3,$4,$5,$6,$7,$8,$9) result', [input.actor,input.player,input.expected,input.reason,input.late,input.matchday,input.intent,input.goals,JSON.stringify(input.picks)])).rows[0].result;
}
async function entry(ids) { return (await db.query('select *,updated_at::text as updated_at from public.entries where user_id=$1 and matchday_id=$2',[ids.player,ids.matchday])).rows[0]; }
async function audit() { return (await db.query('select * from public.pick8_entry_admin_audit order by recorded_at')).rows; }
async function rejected(ids, changes, code) {
  const before = await snapshot(db,ids.matchday);
  const priorAudit = await audit();
  await assert.rejects(save(ids,changes), e => !code || e.code === code);
  assert.deepEqual(await snapshot(db,ids.matchday),before);
  assert.deepEqual(await audit(),priorAudit);
}
try {
  await test('only service_role can execute, including authenticated administrators', async () => {
    const ids = await setup();
    const caller = await cluster.connect(false);
    for (const role of ['anon','authenticated']) {
      await caller.query(`set role ${role}`);
      await assert.rejects(save(ids,{},caller), e => e.code === '42501');
      await assert.rejects(caller.query('select * from public.pick8_entry_admin_audit'), e => e.code === '42501');
      await caller.query('reset role');
    }
    await rejected(ids,{actor:ids.player},'42501');
    await admin.query('update public.profiles set is_active=false where id=$1',[ids.actor]);
    await rejected(ids,{},'42501');
  });
  await test('post-lock requires explicit confirmation and reason; late drafts are rejected', async () => {
    const ids = await setup();
    await rejected(ids,{late:false},'42501');
    await rejected(ids,{late:null},'42501');
    for (const reason of ['', 'abcd', null, 'x'.repeat(1001)]) await rejected(ids,{reason},'22023');
    await rejected(ids,{intent:'draft'},'23514');
    await rejected(ids,{intent:null},'22023');
  });
  await test('validates completeness, distinct fixtures/categories, team sides, goals and matchday membership', async () => {
    const ids = await setup();
    await rejected(ids,{picks:ids.picks.slice(1)},'23514');
    await rejected(ids,{picks:ids.picks.map((p,i)=>i===1?{...p,fixture_id:ids.picks[0].fixture_id}:p)},'23514');
    await rejected(ids,{picks:ids.picks.map((p,i)=>i===1?{...p,category:'home_win',selected_team_side:'home'}:p)},'23514');
    await rejected(ids,{picks:ids.picks.map((p,i)=>i===0?{...p,selected_team_side:null}:p)},'23514');
    await rejected(ids,{picks:ids.picks.map((p,i)=>i===0?{...p,selected_team_side:'away'}:p)},'23514');
    await rejected(ids,{picks:ids.picks.map((p,i)=>i===0?{...p,fixture_id:ids.actor}:p)},'23514');
    for (const goals of [null,-1,101]) await rejected(ids,{goals},'23514');
  });
  await test('backfill stores actual submission time, audit evidence and durable scoring invalidation', async () => {
    const ids = await setup({ status: 'timed', home: null, away: null });
    const before = await snapshot(db,ids.matchday);
    const saved = await save(ids);
    const e = await entry(ids);
    const after = await snapshot(db,ids.matchday);
    assert.equal(saved.entry_id,e.id);
    assert.ok(new Date(e.submitted_at) > new Date(ids.fixtures[0].kickoff_at));
    assert.equal(after.selections.length,8);
    assert.equal(new Set(after.selections.map(s=>s.fixture_id)).size,8);
    assert.ok(after.matchday.scoring_revision > before.matchday.scoring_revision);
    assert.equal(after.matchday.scoring_pending,true);
    const [a] = await audit();
    assert.equal(a.actor_id,ids.actor); assert.equal(a.player_id,ids.player); assert.equal(a.matchday_id,ids.matchday);
    assert.equal(a.post_lock,true); assert.equal(a.before_value,null); assert.equal(a.after_value.selections.length,8);
    assert.equal(+new Date(a.after_value.entry.submitted_at),+new Date(e.submitted_at));
  });
  await test('existing entries cannot be overwritten by a stale or create-only request', async () => {
    const ids = await setup();
    await save(ids);
    await rejected(ids,{goals:29},'40001');
    const e = await entry(ids);
    await rejected(ids,{expected:e.updated_at},'23514');
  });
  await test('correction swaps fixtures atomically, preserves submitted_at, and audits before/after', async () => {
    const ids = await setup();
    await save(ids);
    const e = await entry(ids);
    const picks = ids.picks.map((p,i)=> i===0?{...p,fixture_id:ids.picks[1].fixture_id}:i===1?{...p,fixture_id:ids.picks[0].fixture_id}:p);
    await save(ids,{expected:e.updated_at,intent:'save_changes',picks,goals:29});
    const corrected = await entry(ids);
    assert.equal(+new Date(corrected.submitted_at),+new Date(e.submitted_at));
    const audits = await audit();
    assert.equal(audits.length,2);
    assert.equal(audits[1].before_value.entry.total_goals_prediction,28);
    assert.equal(audits[1].after_value.entry.total_goals_prediction,29);
    assert.equal(audits[1].after_value.selections.find(s=>s.category==='home_win').fixture_id,picks[0].fixture_id);
    await assert.rejects(db.query("update public.pick8_entry_admin_audit set reason='tampered'"),e=>e.code==='42501');
  });
  await test('pre-lock admin drafts remain drafts and can be completed; normal player deadline stays enforced', async () => {
    const ids = await setup({ future:true,status:'timed',home:null,away:null });
    await admin.query("update public.matchdays set status='open' where id=$1",[ids.matchday]);
    await save(ids,{late:false,intent:'draft',picks:ids.picks.slice(0,2),goals:null});
    const draft = await entry(ids); assert.equal(draft.submitted_at,null);
    await save(ids,{late:false,expected:draft.updated_at});
    assert.ok((await entry(ids)).submitted_at);
    const late = await setup();
    const player = await cluster.connect(false);
    await player.query("set role authenticated; set request.jwt.claim.role='authenticated'");
    await player.query("select set_config('request.jwt.claim.sub',$1,false)",[late.player]);
    await assert.rejects(player.query("select public.save_pick8_entry($1,'submit',28,$2)",[late.matchday,JSON.stringify(late.picks)]), /locked/);
    await assert.rejects(player.query('insert into public.entries(user_id,matchday_id) values($1,$2)',[late.player,late.matchday]));
  });
  await test('late additions and corrections are scored through the revision guarded scorer', async () => {
    const ids = await setup();
    await save(ids);
    let state = await snapshot(db,ids.matchday);
    await score(db,ids,state.matchday.scoring_revision);
    const e = await entry(ids);
    assert.equal(e.calculated_score,11); // 6-5+0+10-10+10-10+10, Total Goals 28 misses 30
    assert.equal((await snapshot(db,ids.matchday)).matchday.scoring_pending,false);
    await save(ids,{intent:'save_changes',expected:e.updated_at,goals:30});
    state = await snapshot(db,ids.matchday);
    assert.equal(state.matchday.scoring_pending,true);
    await score(db,ids,state.matchday.scoring_revision);
    assert.equal((await entry(ids)).calculated_score,21);
  });
  await test('audit insertion failure rolls back entry, selections and scoring revision', async () => {
    const ids = await setup();
    await admin.query("create function public.fail_admin_audit() returns trigger language plpgsql as $$ begin raise exception 'audit failure'; end $$; create trigger fail_admin_audit before insert on public.pick8_entry_admin_audit for each row execute function public.fail_admin_audit()");
    await rejected(ids,{},'P0001');
    await admin.query('drop trigger fail_admin_audit on public.pick8_entry_admin_audit; drop function public.fail_admin_audit()');
  });
  await test('concurrent create-only submissions commit once and never overwrite', async () => {
    const ids = await setup();
    const other = await cluster.connect();
    const results = await Promise.allSettled([save(ids),save(ids,{goals:29},other)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected').length,1);
    assert.equal((await audit()).length,1);
    assert.equal((await snapshot(db,ids.matchday)).selections.length,8);
  });
  await test('ordinary players and authenticated admins cannot read another player draft or write their entry', async () => {
    const ids = await setup({future:true,status:'timed',home:null,away:null});
    await admin.query("update public.matchdays set status='open' where id=$1",[ids.matchday]);
    await save(ids,{intent:'draft',late:false,picks:ids.picks.slice(0,2),goals:null});
    const reader = await cluster.connect(false);
    const ordinary = await person();
    await reader.query("set role authenticated; set request.jwt.claim.role='authenticated'");
    for(const who of [ordinary,ids.actor]) {
      await reader.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);
      assert.equal((await reader.query('select * from public.entries where user_id=$1',[ids.player])).rows.length,0);
      assert.equal((await reader.query('select * from public.entry_selections')).rows.length,0);
      await assert.rejects(reader.query('update public.entries set total_goals_prediction=99 where user_id=$1 returning id',[ids.player]),e=>e.code==='42501');
    }
  });
  await test('rules version 1 accepts seven categories and rejects BTTS', async () => {
    const ids = await setup({rulesVersion:1});
    const picks = ids.picks.filter(p=>p.category!=='btts');
    await rejected(ids,{},'23514');
    await save(ids,{picks});
    assert.equal((await snapshot(db,ids.matchday)).selections.length,7);
  });
  await test('inactive players and inactive seasons fail closed', async () => {
    const ids = await setup();
    await admin.query('update public.profiles set pick8_participation_active=false where id=$1',[ids.player]);
    await rejected(ids,{},'42501');
    await admin.query('update public.profiles set pick8_participation_active=true where id=$1',[ids.player]);
    await admin.query('update public.seasons set is_active=false where id=$1',[ids.season]);
    await rejected(ids,{},'23514');
  });
} finally { await cluster.close(); }
