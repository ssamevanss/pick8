// Postponed, rescheduled and interrupted fixtures against the real migrations.
// Run with PICK8_PG_TEST_DEPENDENCIES=/path/to/test-deps node --test tests/pick8-postponed-fixtures-postgres.mjs
// Policy background and the open decisions: docs/postponed-and-interrupted-fixtures.md
import test from 'node:test';
import assert from 'node:assert/strict';
import { categoriesV2, createTestDatabase, seed, snapshot, score } from './helpers/pick8-postgres.mjs';

const cluster = await createTestDatabase();
const admin = cluster.admin;
const db = await cluster.connect();

async function rescore(ids) {
  const before = await snapshot(db, ids.matchday);
  const result = await score(db, ids, before.matchday.scoring_revision);
  return { result, after: await snapshot(db, ids.matchday) };
}

// `seed` finishes every fixture 2-1 and every entry predicts 30 Total Goals, so a void fixture removes
// 3 goals from the matchday and the Total Goals bonus is not paid.
async function seedWithPostponed(entries = 2) {
  const ids = await seed(admin, { entries, rulesVersion: 2 });
  await admin.query(
    "update public.fixtures set status='postponed',home_score=null,away_score=null where id=$1",
    [ids.fixtures[0].id],
  );
  return ids;
}

try {
  await test('a postponed fixture is void: matchday completes, 0 points for its pick, its goals leave Total Goals', async () => {
    const ids = await seedWithPostponed();
    const { result, after } = await rescore(ids);
    assert.equal(result.finalScoringReady, true);
    assert.equal(result.matchdayStatus, 'completed');
    assert.equal(result.voidSelections, 2, 'one void pick per entry');
    const voidPick = after.selections.find(s => s.fixture_id === ids.fixtures[0].id);
    assert.equal(voidPick.points_awarded, null);
    assert.ok(after.entries.every(e => e.calculated_score !== null));
    // 9 finished fixtures at 2-1 make 27 goals, so the 30-goal predictions earn no bonus.
    const expected = after.selections.filter(s => s.entry_id === after.entries[0].id)
      .reduce((total, s) => total + (s.points_awarded ?? 0), 0);
    assert.equal(after.entries[0].calculated_score, expected);
  });

  await test('CURRENT BEHAVIOUR (policy open): rescheduling a void fixture reopens a completed matchday and clears every final score', async () => {
    const ids = await seedWithPostponed();
    const first = await rescore(ids);
    assert.equal(first.result.matchdayStatus, 'completed');
    assert.ok(first.after.entries.every(e => e.calculated_score !== null));

    // Provider gives the postponed match a new date: status timed, kickoff weeks away.
    await admin.query(
      "update public.fixtures set status='timed',kickoff_at=now()+interval '30 days' where id=$1",
      [ids.fixtures[0].id],
    );
    const second = await rescore(ids);
    assert.equal(second.result.finalScoringReady, false);
    assert.equal(second.after.matchday.status, 'scoring');
    assert.ok(second.after.entries.every(e => e.calculated_score === null && e.score_calculated_at === null),
      'every player loses the matchday score from standings until the rescheduled match is played');

    // When it is played, the matchday completes again and Total Goals now includes that match.
    await admin.query(
      "update public.fixtures set status='finished',home_score=2,away_score=1,kickoff_at=now()-interval '1 hour' where id=$1",
      [ids.fixtures[0].id],
    );
    const third = await rescore(ids);
    assert.equal(third.result.matchdayStatus, 'completed');
    assert.ok(third.after.entries.every(e => e.calculated_score !== null));
  });

  await test('a void fixture with a future kickoff blocks completion instead of completing early', async () => {
    const ids = await seedWithPostponed(1);
    await admin.query("update public.fixtures set kickoff_at=now()+interval '2 days' where id=$1", [ids.fixtures[0].id]);
    const before = await snapshot(db, ids.matchday);
    await assert.rejects(
      score(db, ids, before.matchday.scoring_revision),
      error => /cannot be completed before every configured kickoff/.test(error.message),
    );
  });

  await test('entry deadline cannot move later after it has elapsed (late reschedule of the earliest fixture)', async () => {
    const ids = await seed(admin, { entries: 1, rulesVersion: 2, draft: true, status: 'timed', home: null, away: null, future: true });
    const userId = (await admin.query('select user_id from public.entries where matchday_id=$1', [ids.matchday])).rows[0].user_id;
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
    await admin.query("update public.matchdays set status='open' where id=$1", [ids.matchday]);
    // Nine fixtures tomorrow; the earliest kicked off a minute ago, so the matchday is locked.
    await admin.query("update public.fixtures set kickoff_at=now()+interval '1 day' where matchday_id=$1", [ids.matchday]);
    await admin.query("update public.fixtures set kickoff_at=now()-interval '1 minute' where id=$1", [ids.fixtures[0].id]);
    const selections = JSON.stringify(categoriesV2.map((category, index) => ({
      category, fixture_id: ids.fixtures[index].id,
      selected_team_side: category === 'draw' || category === 'btts' ? null : category === 'away_win' ? 'away' : 'home',
    })));
    const save = () => db.query('select public.save_pick8_entry($1,$2,$3,$4::jsonb) as result',
      [ids.matchday, 'submit', 30, selections]);
    const gate = async () => (await db.query('select public.can_submit_pick8_matchday($1,$2) as open', [ids.matchday, userId])).rows[0].open;

    assert.equal(await gate(), false);
    await assert.rejects(save(), error => error.code === '42501');

    // The provider now reports a new date for the earliest fixture. The next fixture is still a day away.
    await admin.query("update public.fixtures set status='timed',kickoff_at=now()+interval '30 days' where id=$1", [ids.fixtures[0].id]);
    assert.equal(await gate(), false, 'a passed deadline must not reopen');
    await assert.rejects(save(), error => error.code === '42501');
    const lock = (await admin.query('select locks_at from public.matchdays where id=$1', [ids.matchday])).rows[0].locks_at;
    assert.ok(lock <= new Date(), 'the stored deadline stays at the original, elapsed kickoff');
  });

  await test('before the deadline elapses a postponed earliest fixture still extends the window to the next kickoff', async () => {
    const ids = await seed(admin, { entries: 1, rulesVersion: 2, draft: true, status: 'timed', home: null, away: null, future: true });
    const userId = (await admin.query('select user_id from public.entries where matchday_id=$1', [ids.matchday])).rows[0].user_id;
    await admin.query("update public.matchdays set status='open' where id=$1", [ids.matchday]);
    await admin.query("update public.fixtures set kickoff_at=now()+interval '2 days' where matchday_id=$1", [ids.matchday]);
    await admin.query("update public.fixtures set kickoff_at=now()+interval '1 hour' where id=$1", [ids.fixtures[0].id]);
    const gate = async () => (await db.query('select public.can_submit_pick8_matchday($1,$2) as open', [ids.matchday, userId])).rows[0].open;
    assert.equal(await gate(), true);
    await admin.query("update public.fixtures set status='postponed',kickoff_at=now()+interval '30 days' where id=$1", [ids.fixtures[0].id]);
    assert.equal(await gate(), true);
    const lock = (await admin.query('select locks_at from public.matchdays where id=$1', [ids.matchday])).rows[0].locks_at;
    assert.ok(lock > new Date(Date.now() + 24 * 3600 * 1000), 'deadline moves to the next kickoff while still open');
  });

  await test('an earlier reschedule after the deadline still tightens it', async () => {
    const ids = await seed(admin, { entries: 1, rulesVersion: 2, draft: true, status: 'timed', home: null, away: null, future: true });
    await admin.query("update public.fixtures set kickoff_at=now()+interval '1 day' where matchday_id=$1", [ids.matchday]);
    await admin.query("update public.fixtures set kickoff_at=now()-interval '1 hour' where id=$1", [ids.fixtures[0].id]);
    await admin.query("update public.fixtures set kickoff_at=now()-interval '3 hours' where id=$1", [ids.fixtures[0].id]);
    const lock = (await admin.query('select locks_at from public.matchdays where id=$1', [ids.matchday])).rows[0].locks_at;
    assert.ok(lock <= new Date(Date.now() - 2.5 * 3600 * 1000));
  });
} finally { await cluster.close(); }
