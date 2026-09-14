// Run with PICK8_PG_TEST_DEPENDENCIES=/path/to/test-deps node --test tests/pick8-scoring-postgres.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, referenceScorer, seed, snapshot, score } from './helpers/pick8-postgres.mjs';

const cluster = await createTestDatabase();
const admin = cluster.admin;
const db = await cluster.connect();
const writer = await cluster.connect();
const reference = referenceScorer();
function compare(before, after, result) {
  const fixtures = new Map(before.fixtures.map(f => [f.id, f]));
  const final = reference.isMatchdayReadyForFinalScoring(before.fixtures);
  const goals = reference.calculateCompletedMatchdayGoalTotal(before.fixtures);
  assert.equal(result.finalScoringReady, final);
  for (const entry of before.entries) {
    const actual = after.entries.find(e => e.id === entry.id);
    if (!entry.submitted_at) {
      assert.equal(actual.calculated_score, null); assert.equal(actual.score_calculated_at, null);
      assert.deepEqual(after.selections.filter(s => s.entry_id === entry.id), before.selections.filter(s => s.entry_id === entry.id));
      continue;
    }
    const expected = reference.scoreEntry({ selections: before.selections.filter(s=>s.entry_id===entry.id), fixturesById: fixtures,
      totalGoalsPrediction: entry.total_goals_prediction, finalScoringReady: final, completedGoalTotal: goals });
    assert.equal(actual.calculated_score, expected.calculatedScore);
    assert.equal(actual.score_calculated_at !== null, final);
    for (const pick of expected.selectionScores) {
      const actual = after.selections.find(s=>s.id===pick.id);
      assert.equal(actual.points_awarded, pick.pointsAwarded, pick.category);
      assert.equal(actual.is_correct, pick.isCorrect, pick.category);
    }
  }
  assert.equal(after.matchday.scoring_pending, false);
  assert.equal(after.matchday.scored_revision, before.matchday.scoring_revision);
  assert.equal(after.matchday.scoring_revision, before.matchday.scoring_revision);
}
async function verify(ids, accelerated = false) {
  const before = await snapshot(db, ids.matchday);
  const start = performance.now();
  const result = await score(db, ids, before.matchday.scoring_revision, accelerated);
  const duration = performance.now() - start;
  const after = await snapshot(db, ids.matchday);
  compare(before, after, result);
  return { before, after, result, duration };
}
async function inject(table, body, deferred = false) {
  await admin.query(`create function public.test_scoring_fault() returns trigger language plpgsql as $$ begin ${body}; return new; end $$;
    create ${deferred ? 'constraint' : ''} trigger test_scoring_fault after update on public.${table}
    ${deferred ? 'deferrable initially deferred' : ''} for each row execute function public.test_scoring_fault();`);
}
async function clearFault(table) {
  await admin.query(`drop trigger test_scoring_fault on public.${table}; drop function public.test_scoring_fault()`);
}
async function expectRollback(ids, operation, code) {
  const before = await snapshot(db, ids.matchday);
  await assert.rejects(operation(), code ? e => e.code === code : undefined);
  assert.deepEqual(await snapshot(db, ids.matchday), before);
}

try {
  await test('SQL matches unchanged TypeScript rules: all seven categories, both sides, wins/losses and draw ladder', async () => {
    const ids = await seed(admin, { entries: 1 });
    for (const side of ['home','away']) for (let home=0; home<=5; home++) for (let away=0; away<=5; away++) {
      await db.query('update public.fixtures set home_score=$1,away_score=$2 where matchday_id=$3', [home,away,ids.matchday]);
      await db.query("update public.entry_selections set selected_team_side=$1 where category in ('team_win','team_lose','team_score','clean_sheet')", [side]);
      await verify(ids);
    }
    // Draw points are an unbounded formula, not a capped lookup ladder.
    for (const goals of [6,7,8,9,10,15,20,100]) {
      await db.query('update public.fixtures set home_score=$1,away_score=$1 where matchday_id=$2', [goals,ids.matchday]);
      await verify(ids);
      assert.equal((await db.query("select points_awarded from public.entry_selections where category='draw'")).rows[0].points_awarded,15+goals);
    }
  });
  await test('unfinished/null/void fixtures and finished fixtures with missing scores retain exact semantics', async () => {
    for (const status of ['scheduled','timed','in_play','paused','postponed','cancelled','finished']) {
      for (const home of [null,2]) for (const away of [null,1]) {
        const ids = await seed(admin, { entries: 1, status, home, away });
        await verify(ids);
      }
    }
    const ids = await seed(admin, { entries:1, status:'finished' });
    await db.query("update public.fixtures set status='postponed',home_score=9,away_score=9 where id=$1",[ids.fixtures[0].id]);
    await verify(ids);
  });
  await test('26 entries / 182 selections: final scoring, exact Total Goals bonus, then zero changed output rows', async () => {
    const ids = await seed(admin);
    const first = await verify(ids);
    assert.equal(first.result.selectionRowsConsidered,182); assert.equal(first.result.selectionRowsChanged,182);
    assert.equal(first.result.entryRowsConsidered,26); assert.equal(first.result.entryRowsChanged,26);
    // Re-run actual calculation, rather than just reuse the checkpoint.
    await db.query('update public.matchdays set scoring_pending=true where id=$1',[ids.matchday]);
    const second = await verify(ids);
    assert.equal(second.result.selectionRowsChanged,0); assert.equal(second.result.entryRowsChanged,0);
    assert.deepEqual(second.after.entries,first.after.entries);
    assert.deepEqual(second.after.selections,first.after.selections);
    console.log(JSON.stringify({benchmark:'postgres-26-182', firstRpcMs:first.duration, unchangedRpcMs:second.duration,
      first:first.result, unchanged:second.result}));
  });
  await test('interim entry totals stay null, stale draft totals reset, draft selections untouched', async () => {
    const ids = await seed(admin, { entries:2 });
    await db.query("update public.fixtures set status='timed',home_score=null,away_score=null where id=$1",[ids.fixtures[9].id]);
    const entry=(await db.query('select id from public.entries limit 1')).rows[0].id;
    await db.query('update public.entries set submitted_at=null,calculated_score=999,score_calculated_at=now() where id=$1',[entry]);
    const {result}=await verify(ids);
    assert.equal(result.entryRowsChanged,1); assert.equal(result.entriesFinalized,0);
    assert.equal(result.selectionsScored,7);
  });
  await test('finalization requires every kickoff unless explicitly accelerated AND manual AND test', async () => {
    for (const manual of [false,true]) for (const accelerated of [false,true]) for (const allow of [false,true]) {
      if (accelerated && !manual) {
        await assert.rejects(seed(admin,{entries:1,future:true,manual,accelerated}), e=>e.code==='23514');
        continue;
      }
      const ids=await seed(admin,{entries:1,future:true,manual,accelerated});
      const revision=(await snapshot(db,ids.matchday)).matchday.scoring_revision;
      if (manual&&accelerated&&allow) await verify(ids,true);
      else await expectRollback(ids,()=>score(db,ids,revision,allow));
    }
  });
  await test('empty fixture set is not final-ready', async()=>{
    const ids=await seed(admin,{entries:0});
    await db.query('delete from public.fixtures where matchday_id=$1',[ids.matchday]);
    const {result}=await verify(ids); assert.equal(result.finalScoringReady,false);
  });
  await test('failure during scoring rolls back every output and checkpoint',async()=>{
    const ids=await seed(admin,{entries:2});
    await inject('entries',"raise exception 'injected entry failure'");
    try { await expectRollback(ids,async()=>score(db,ids,(await snapshot(db,ids.matchday)).matchday.scoring_revision)); }
    finally { await clearFault('entries'); }
    await verify(ids);
  });
  await test('acknowledgement failure rolls back output updates',async()=>{
    const ids=await seed(admin,{entries:2});
    await inject('matchdays',"if not new.scoring_pending then raise exception 'injected acknowledgement failure'; end if");
    try { await expectRollback(ids,async()=>score(db,ids,(await snapshot(db,ids.matchday)).matchday.scoring_revision)); }
    finally { await clearFault('matchdays'); }
  });
  await test('deferred constraint failure at commit rolls back outputs AND acknowledgement',async()=>{
    const ids=await seed(admin,{entries:2});
    await inject('entry_selections',"raise exception 'injected commit failure'",true);
    try { await expectRollback(ids,async()=>score(db,ids,(await snapshot(db,ids.matchday)).matchday.scoring_revision)); }
    finally { await clearFault('entry_selections'); }
  });
  await test('stale revision and missing durable pending fail before outputs',async()=>{
    const ids=await seed(admin,{entries:1});
    const revision=(await snapshot(db,ids.matchday)).matchday.scoring_revision;
    await expectRollback(ids,()=>score(db,ids,revision-1),'40001');
    await db.query('update public.matchdays set scoring_pending=false where id=$1',[ids.matchday]);
    await expectRollback(ids,()=>score(db,ids,revision));
  });
  await test('lost response is recoverable from a transactionally stored result; repeated acknowledged RPC changes nothing',async()=>{
    const ids=await seed(admin,{entries:1});
    const revision=(await snapshot(db,ids.matchday)).matchday.scoring_revision;
    await score(db,ids,revision); // Discard the response as though the gateway lost it.
    const committed=await snapshot(writer,ids.matchday);
    assert.equal(committed.matchday.scoring_pending,false);
    assert.equal(committed.matchday.scoring_result.acknowledgedRevision,revision);
    const repeated=await score(writer,ids,revision);
    assert.equal(repeated.reused,true);
    assert.deepEqual(await snapshot(db,ids.matchday),committed);
  });
  await test('fixture correction/removal invalidates and re-scores accurately',async()=>{
    const ids=await seed(admin,{entries:2}); await verify(ids);
    await db.query('update public.fixtures set home_score=0,away_score=3 where id=$1',[ids.fixtures[0].id]);
    await verify(ids);
    // Exact existing provider removal lifecycle: affected entries become drafts
    // before their selections/fixture are removed.
    await db.query('begin');
    await db.query('update public.entries set submitted_at=null,calculated_score=null,score_calculated_at=null');
    await db.query('delete from public.entry_selections where fixture_id=$1',[ids.fixtures[0].id]);
    await db.query('delete from public.fixtures where id=$1',[ids.fixtures[0].id]);
    await db.query('commit');
    await verify(ids);
  });

  // A test-only barrier pauses the scorer AFTER its consistent snapshot and
  // child locks. The second connection can commit fixture changes meanwhile.
  await admin.query(`create function public.test_scoring_barrier() returns trigger language plpgsql as $$ begin
    if current_setting('pick8.test_barrier',true)='on' then perform pg_advisory_xact_lock(424242); end if; return new; end $$;
    create trigger test_scoring_barrier before update on public.entry_selections for each row execute function public.test_scoring_barrier()`);
  async function paused(ids) {
    await writer.query('select pg_advisory_lock(424242)');
    await db.query("set pick8.test_barrier='on'");
    const revision=(await snapshot(db,ids.matchday)).matchday.scoring_revision;
    const promise=score(db,ids,revision).then(result=>({result}),error=>({error}));
    const until=Date.now()+2000;
    while(Date.now()<until) {
      const blocked=(await admin.query("select 1 from pg_stat_activity where pid=$1 and wait_event='advisory'",[db.processID])).rows.length;
      if(blocked) return {promise,revision};
      await new Promise(r=>setTimeout(r,5));
    }
    throw Error('Scorer did not reach test barrier');
  }
  async function release() { await writer.query('select pg_advisory_unlock(424242)'); }
  await test('concurrent committed fixture input invalidates final CAS and rolls back stale outputs',async()=>{
    const ids=await seed(admin,{entries:2}); const before=await snapshot(db,ids.matchday);
    const pending=await paused(ids);
    await writer.query('update public.fixtures set home_score=4 where id=$1',[ids.fixtures[0].id]);
    await release(); const {error}=await pending.promise;
    assert.equal(error?.code,'40001');
    const after=await snapshot(db,ids.matchday);
    assert.deepEqual(after.entries,before.entries); assert.deepEqual(after.selections,before.selections);
    assert.equal(after.matchday.scoring_pending,true);
    assert.ok(after.matchday.scoring_revision>pending.revision);
    await db.query("set pick8.test_barrier='off'"); await verify(ids);
  });
  await test('overlapping scorer fails promptly at advisory lock, then reuses committed revision',async()=>{
    const ids=await seed(admin,{entries:2}); const pending=await paused(ids);
    await assert.rejects(score(writer,ids,pending.revision),e=>e.code==='55P03');
    await release(); const {result,error}=await pending.promise; assert.ifError(error); assert.equal(result.reused,false);
    assert.equal((await score(writer,ids,pending.revision)).reused,true);
    await db.query("set pick8.test_barrier='off'");
  });
  await test('actual child→trigger→parent writer cannot deadlock scorer holding child rows',async()=>{
    const ids=await seed(admin,{entries:2});
    await writer.query('begin');
    await writer.query("update public.entry_selections set selected_team_side='away' where category='team_win'");
    const start=performance.now();
    await expectRollback(ids,async()=>score(db,ids,(await snapshot(db,ids.matchday)).matchday.scoring_revision),'55P03');
    assert.ok(performance.now()-start<1000);
    await writer.query('commit'); await verify(ids);
  });
  await test('parent held by input transaction at final acknowledgement fails NOWAIT without child/parent cycle',async()=>{
    const ids=await seed(admin,{entries:2}); const before=await snapshot(db,ids.matchday);
    const pending=await paused(ids);
    await writer.query('begin');
    await writer.query('update public.fixtures set home_score=4 where id=$1',[ids.fixtures[0].id]);
    await release(); const {error}=await pending.promise; assert.equal(error?.code,'55P03');
    await writer.query('commit');
    const after=await snapshot(db,ids.matchday); assert.deepEqual(after.selections,before.selections);
    assert.deepEqual(after.entries,before.entries);
    await db.query("set pick8.test_barrier='off'"); await verify(ids);
  });
  await test('season lifecycle lock contention times out and rolls back scoring',async()=>{
    const ids=await seed(admin,{entries:2});
    await writer.query('begin'); await writer.query('select id from public.seasons where id=$1 for update',[ids.season]);
    const start=performance.now();
    await expectRollback(ids,async()=>score(db,ids,(await snapshot(db,ids.matchday)).matchday.scoring_revision),'55P03');
    assert.ok(performance.now()-start<1500);
    await writer.query('commit'); await verify(ids);
  });
  await test('ordinary authenticated/anonymous users cannot execute scorer or forge checkpoint',async()=>{
    const ids=await seed(admin,{entries:1}); const revision=(await snapshot(db,ids.matchday)).matchday.scoring_revision;
    for(const role of ['anon','authenticated']) {
      await writer.query(`set role ${role}; set request.jwt.claim.role='${role}'`);
      await assert.rejects(score(writer,ids,revision),e=>e.code==='42501');
    }
    // Even an authenticated admin with table UPDATE rights cannot forge it.
    const user=(await admin.query('select id from public.profiles limit 1')).rows[0].id;
    await admin.query('update public.profiles set is_admin=true where id=$1',[user]);
    await writer.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
    await assert.rejects(writer.query('update public.matchdays set scored_revision=$1 where id=$2',[revision,ids.matchday]),e=>e.code==='42501');
    await writer.query("set role service_role; set request.jwt.claim.role='service_role'");
    await verify(ids);
  });
} finally { await cluster.close(); }
