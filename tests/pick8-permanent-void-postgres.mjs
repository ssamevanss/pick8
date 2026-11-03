// Permanent void settlement against the real migrations in an embedded Postgres.
// Run with PICK8_PG_TEST_DEPENDENCIES=/path/to/test-deps node --test tests/pick8-permanent-void-postgres.mjs
// Policy and rationale: docs/permanent-void-settlement.md
import test from 'node:test';
import assert from 'node:assert/strict';
import { categoriesV2, createTestDatabase, referenceScorer, seed, snapshot, score, typeScriptModule } from './helpers/pick8-postgres.mjs';

const cluster = await createTestDatabase();
const admin = cluster.admin;
const db = await cluster.connect();
const reference = referenceScorer();
const { decideFixtureVoid, isInterruptedFixtureExpired } = typeScriptModule('utils/pick8-fixture-void.ts');

// `seed` finishes every fixture 2-1 and every entry predicts 30 Total Goals. With the eight v2 categories on fixtures 0-7
// (home_win, away_win, draw, team_win, team_lose, team_score, clean_sheet, btts) an entry earns 11 from picks plus 10 for
// 30 goals = 21. A void home_win pick removes 6 points and 3 goals: 5, with the Total Goals bonus lost.
const FULL_SCORE = 21;
const VOID_HOME_WIN_SCORE = 5;

async function rescore(ids) {
  const before = await snapshot(db, ids.matchday);
  const result = await score(db, ids, before.matchday.scoring_revision);
  return { result, before, after: await snapshot(db, ids.matchday) };
}
const fixture = async (id) => (await admin.query('select * from public.fixtures where id=$1', [id])).rows[0];
const set = (id, fields) => {
  const keys = Object.keys(fields);
  return admin.query(`update public.fixtures set ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} where id=$1`, [id, ...keys.map(k => fields[k])]);
};
const scores = (after) => after.entries.map(e => e.calculated_score);
const lockedAt = async (ids) => (await admin.query('select locks_at from public.matchdays where id=$1', [ids.matchday])).rows[0].locks_at;
const NEXT_DAY = '2099-03-15T15:00:00Z';
const SAME_DAY = '2099-03-14T15:00:00Z';

// A completed-matchday fixture set where fixtures[0] has not started: scheduled later today-ish, matchday locked by the others.
async function seedWithPendingFirst(entries = 2) {
  const ids = await seed(admin, { entries, rulesVersion: 2 });
  await set(ids.fixtures[0].id, { status: 'timed', home_score: null, away_score: null, kickoff_at: SAME_DAY });
  return ids;
}

try {
  await test('postponement before kickoff: voided at once, the matchday completes on the rest, zero points, goals excluded', async () => {
    const ids = await seedWithPendingFirst();
    await set(ids.fixtures[0].id, { status: 'postponed' });
    const row = await fixture(ids.fixtures[0].id);
    assert.equal(row.void_reason, 'postponed');
    assert.ok(row.voided_at);
    const { result, after } = await rescore(ids);
    assert.equal(result.finalScoringReady, true);
    assert.equal(result.matchdayStatus, 'completed');
    assert.equal(result.voidSelections, 2, 'one void pick per entry');
    assert.ok(after.selections.filter(s => s.fixture_id === ids.fixtures[0].id).every(s => s.points_awarded === null));
    assert.deepEqual(scores(after), [VOID_HOME_WIN_SCORE, VOID_HOME_WIN_SCORE], '27 goals: the 30-goal prediction no longer earns the bonus');
  });

  await test('postponement of a fixture in a matchday that has not locked yet is void too (and not selectable)', async () => {
    const ids = await seed(admin, { entries: 1, rulesVersion: 2, draft: true, status: 'timed', home: null, away: null, future: true });
    await set(ids.fixtures[0].id, { status: 'postponed' });
    assert.equal((await fixture(ids.fixtures[0].id)).void_reason, 'postponed');
  });

  await test('postponement after the matchday lock: void, and the entry deadline neither reopens nor lets picks change', async () => {
    const ids = await seed(admin, { entries: 1, rulesVersion: 2, draft: true, status: 'timed', home: null, away: null, future: true });
    const userId = (await admin.query('select user_id from public.entries where matchday_id=$1', [ids.matchday])).rows[0].user_id;
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
    await admin.query("update public.matchdays set status='open' where id=$1", [ids.matchday]);
    await admin.query("update public.fixtures set kickoff_at=now()+interval '1 day' where matchday_id=$1", [ids.matchday]);
    await set(ids.fixtures[1].id, { kickoff_at: new Date(Date.now() - 60_000).toISOString() });
    const selections = JSON.stringify(categoriesV2.map((category, index) => ({
      category, fixture_id: ids.fixtures[index].id,
      selected_team_side: category === 'draw' || category === 'btts' ? null : category === 'away_win' ? 'away' : 'home',
    })));
    const gate = async () => (await db.query('select public.can_submit_pick8_matchday($1,$2) as open', [ids.matchday, userId])).rows[0].open;
    const save = (intent) => db.query('select public.save_pick8_entry($1,$2,$3,$4::jsonb) as result', [ids.matchday, intent, 30, selections]);
    assert.equal(await gate(), false, 'locked: the second fixture kicked off a minute ago');
    const deadline = await lockedAt(ids);

    // The first (still upcoming) fixture is postponed, then moved to a new date; the earliest kickoff moves later.
    await set(ids.fixtures[0].id, { status: 'postponed' });
    await set(ids.fixtures[0].id, { status: 'timed', kickoff_at: '2099-03-14T15:00:00Z' });
    await set(ids.fixtures[1].id, { status: 'timed', kickoff_at: '2099-03-14T16:00:00Z' });
    const earliest = await fixture(ids.fixtures[1].id);
    assert.equal(earliest.void_reason, 'rescheduled', 'a started-looking fixture moved a day later after the lock is void too');
    assert.equal(await gate(), false);
    assert.deepEqual(await lockedAt(ids), deadline, 'the stored deadline did not move');
    for (const intent of ['draft', 'submit', 'save_changes']) {
      await assert.rejects(save(intent), error => error.code === '42501', intent);
    }
  });

  await test('a fixture moved to another calendar day is void, after the lock or before it; a delay on the same day is not', async () => {
    const ids = await seedWithPendingFirst(1);
    const id = ids.fixtures[0].id;
    await set(id, { kickoff_at: '2099-03-14T18:00:00Z' });
    assert.equal((await fixture(id)).voided_at, null, 'three hours later the same day is the same scheduled match');
    await set(id, { kickoff_at: '2099-03-14T14:00:00Z' });
    assert.equal((await fixture(id)).voided_at, null, 'earlier is never a postponement');
    await set(id, { kickoff_at: NEXT_DAY });
    const row = await fixture(id);
    assert.equal(row.void_reason, 'rescheduled');
    const before = row.voided_at;
    await set(id, { kickoff_at: '2099-03-15T16:00:00Z' });
    assert.deepEqual((await fixture(id)).voided_at, before);
  });

  await test('pre-deadline: moved to another day before the entry deadline is void for good; a same-day delay is not; the lock still works', async () => {
    const ids = await seed(admin, { entries: 2, rulesVersion: 2, status: 'timed', home: null, away: null, future: true });
    const [moved, delayed, other] = ids.fixtures;
    assert.ok(Date.parse(await lockedAt(ids)) > Date.now() || (await lockedAt(ids)) === null, 'the entry deadline is still ahead');
    const kickoff = (await fixture(moved.id)).kickoff_at;
    const sameDay = new Date(Date.parse(kickoff) + 60_000).toISOString();

    await set(delayed.id, { kickoff_at: sameDay });
    assert.equal((await fixture(delayed.id)).voided_at, null, 'a delay within the same day is the same match');
    await set(moved.id, { kickoff_at: '2099-03-15T15:00:00Z' });
    const row = await fixture(moved.id);
    assert.equal(row.void_reason, 'rescheduled');
    assert.ok(row.voided_at);

    // Neither a move back, nor a replay score, nor the provider reporting it timed again brings it back.
    await set(moved.id, { kickoff_at: kickoff });
    await set(moved.id, { status: 'finished', home_score: 5, away_score: 5 });
    assert.deepEqual((await fixture(moved.id)).voided_at, row.voided_at);
    assert.equal((await fixture(other.id)).voided_at, null);

    // When the others have been played the matchday completes on them: the void pick scores nothing and its goals never count.
    await admin.query(`update public.fixtures set status='finished', home_score=2, away_score=1, kickoff_at=now()-interval '3 hours'
      where matchday_id=$1 and id <> $2`, [ids.matchday, moved.id]);
    const { result, after } = await rescore(ids);
    assert.equal(result.matchdayStatus, 'completed');
    assert.equal(result.voidSelections, 2);
    assert.ok(after.selections.filter(s => s.fixture_id === moved.id).every(s => s.points_awarded === null));
    assert.deepEqual(scores(after), [VOID_HOME_WIN_SCORE, VOID_HOME_WIN_SCORE], '27 goals: the replayed 5-5 and the 30-goal prediction do not count');
  });

  await test('pre-deadline: the entry deadline is not reopened or extended by the void, and picks stay locked once it passes', async () => {
    const ids = await seed(admin, { entries: 1, rulesVersion: 2, draft: true, status: 'timed', home: null, away: null, future: true });
    const userId = (await admin.query('select user_id from public.entries where matchday_id=$1', [ids.matchday])).rows[0].user_id;
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
    await admin.query("update public.matchdays set status='open' where id=$1", [ids.matchday]);
    await admin.query("update public.fixtures set kickoff_at=now()+interval '1 day' where matchday_id=$1", [ids.matchday]);
    const gate = async () => (await db.query('select public.can_submit_pick8_matchday($1,$2) as open', [ids.matchday, userId])).rows[0].open;
    assert.equal(await gate(), true, 'open before the first kickoff');
    await set(ids.fixtures[0].id, { kickoff_at: '2099-03-14T15:00:00Z' });
    assert.equal((await fixture(ids.fixtures[0].id)).void_reason, 'rescheduled');
    assert.equal(await gate(), true, 'still open: the other fixtures have not kicked off');
    await set(ids.fixtures[1].id, { kickoff_at: new Date(Date.now() - 60_000).toISOString() });
    assert.equal(await gate(), false, 'locked at the first remaining kickoff');
    const deadline = await lockedAt(ids);
    await set(ids.fixtures[0].id, { kickoff_at: new Date(Date.now() + 3600_000).toISOString() });
    await set(ids.fixtures[1].id, { kickoff_at: new Date(Date.now() + 7200_000).toISOString() });
    assert.equal(await gate(), false, 'moving fixtures later after the lock never reopens entries');
    assert.deepEqual(await lockedAt(ids), deadline);
  });

  await test('rescheduled fixture eventually played: the matchday, scores and Total Goals do not move', async () => {
    const ids = await seedWithPendingFirst();
    await set(ids.fixtures[0].id, { status: 'postponed' });
    const first = await rescore(ids);
    assert.equal(first.after.matchday.status, 'completed');
    const scoredAt = first.after.entries.map(e => e.score_calculated_at);

    await set(ids.fixtures[0].id, { status: 'timed', kickoff_at: NEXT_DAY });
    const second = await rescore(ids);
    assert.equal(second.result.finalScoringReady, true);
    assert.equal(second.after.matchday.status, 'completed');
    assert.deepEqual(scores(second.after), scores(first.after));

    await set(ids.fixtures[0].id, { status: 'finished', home_score: 6, away_score: 0, kickoff_at: new Date(Date.now() - 3600_000).toISOString() });
    const third = await rescore(ids);
    assert.equal(third.after.matchday.status, 'completed');
    assert.deepEqual(scores(third.after), scores(first.after), 'the replayed 6-0 scores nothing and adds no goals');
    assert.deepEqual(third.after.entries.map(e => e.score_calculated_at), scoredAt, 'no entry row was rewritten');
    assert.ok(third.after.selections.filter(s => s.fixture_id === ids.fixtures[0].id).every(s => s.points_awarded === null && s.is_correct === null));
    assert.equal(third.result.voidSelections, 2);
  });

  await test('a previously completed matchday keeps its scores, standings inputs and status through later provider updates', async () => {
    const ids = await seedWithPendingFirst();
    await set(ids.fixtures[0].id, { status: 'postponed' });
    const base = await rescore(ids);
    const deadline = await lockedAt(ids);
    for (const update of [
      { status: 'timed', kickoff_at: NEXT_DAY },
      { kickoff_at: '2099-04-01T15:00:00Z' },
      { status: 'in_play', home_score: 0, away_score: 0 },
      { status: 'finished', home_score: 3, away_score: 3 },
      { status: 'timed', home_score: null, away_score: null, kickoff_at: '2099-05-01T15:00:00Z' },
    ]) {
      await set(ids.fixtures[0].id, update);
      const { after, result } = await rescore(ids);
      assert.equal(after.matchday.status, 'completed', JSON.stringify(update));
      assert.equal(result.finalScoringReady, true);
      assert.deepEqual(scores(after), scores(base.after));
      assert.ok(after.entries.every(e => e.score_calculated_at !== null));
    }
    assert.deepEqual(await lockedAt(ids), deadline);
  });

  await test('seven completed fixtures and one voided: the eight-pick matchday scores the seven, Total Goals counts their goals only', async () => {
    const ids = await seed(admin, { entries: 3, rulesVersion: 2 });
    await admin.query('delete from public.fixtures where id = any($1)', [[ids.fixtures[8].id, ids.fixtures[9].id]]);
    const [a, b, c] = (await admin.query('select id from public.entries order by id')).rows;
    // 7 finished fixtures x 3 goals = 21. A: exact. B: the figure with the void fixture counted. C: unrelated.
    for (const [entry, goals] of [[a, 21], [b, 24], [c, 0]]) {
      await admin.query('update public.entries set total_goals_prediction=$2 where id=$1', [entry.id, goals]);
    }
    const btts = ids.fixtures[7];
    await set(btts.id, { status: 'postponed', home_score: null, away_score: null });
    const before = await snapshot(db, ids.matchday);
    const result = await score(db, ids, before.matchday.scoring_revision);
    const after = await snapshot(db, ids.matchday);
    assert.equal(result.matchdayStatus, 'completed');
    assert.equal(result.voidSelections, 3);
    assert.equal(result.selectionsScored, 21);
    const byEntry = Object.fromEntries(after.entries.map(e => [e.id, e.calculated_score]));
    assert.equal(byEntry[a.id], 1 + 10, 'seven picks earn 1 (11 less the void btts +10); exact 21 goals earn the bonus');
    assert.equal(byEntry[b.id], 1, '24 goals only existed with the void fixture');
    assert.equal(byEntry[c.id], 1);
    const fixtures = new Map(before.fixtures.map(f => [f.id, f]));
    const goals = reference.calculateCompletedMatchdayGoalTotal(before.fixtures);
    assert.equal(goals, 21);
    for (const entry of before.entries) {
      const expected = reference.scoreEntry({ selections: before.selections.filter(s => s.entry_id === entry.id), fixturesById: fixtures,
        totalGoalsPrediction: entry.total_goals_prediction, finalScoringReady: reference.isMatchdayReadyForFinalScoring(before.fixtures), completedGoalTotal: goals });
      assert.equal(byEntry[entry.id], expected.calculatedScore, 'SQL matches the TypeScript oracle');
    }
  });

  await test('Total Goals excludes a voided fixture even after it is replayed with a score', async () => {
    const ids = await seedWithPendingFirst(1);
    await set(ids.fixtures[0].id, { status: 'postponed' });
    await set(ids.fixtures[0].id, { status: 'finished', home_score: 4, away_score: 4, kickoff_at: NEXT_DAY });
    await admin.query('update public.entries set total_goals_prediction=27 where matchday_id=$1', [ids.matchday]);
    const { after } = await rescore(ids);
    assert.equal(after.entries[0].calculated_score, VOID_HOME_WIN_SCORE + 10, '27 = nine fixtures x 3; the replayed 8 goals are not counted');
  });

  await test('a suspended match holds the matchday; if it resumes it is scored normally and is never voided', async () => {
    const ids = await seed(admin, { entries: 2, rulesVersion: 2 });
    const id = ids.fixtures[0].id;
    await set(id, { status: 'suspended', home_score: 1, away_score: 0 });
    const held = await rescore(ids);
    assert.equal(held.result.finalScoringReady, false);
    assert.equal(held.after.matchday.status, 'scoring');
    assert.ok(held.after.entries.every(e => e.calculated_score === null));
    assert.equal((await fixture(id)).voided_at, null);

    await set(id, { status: 'in_play' });
    assert.equal((await fixture(id)).voided_at, null);
    await set(id, { status: 'finished', home_score: 2, away_score: 1 });
    const done = await rescore(ids);
    assert.equal(done.after.matchday.status, 'completed');
    assert.deepEqual(scores(done.after), [FULL_SCORE, FULL_SCORE]);
    assert.equal((await fixture(id)).voided_at, null);
  });

  await test('a suspended match resumed on the same day is the same match; moved to a later day it is a replay and void', async () => {
    const ids = await seedWithPendingFirst(1);
    const id = ids.fixtures[0].id;
    await set(id, { status: 'suspended', home_score: 1, away_score: 0 });
    await set(id, { status: 'timed', kickoff_at: '2099-03-14T20:00:00Z' });
    assert.equal((await fixture(id)).voided_at, null);
    await set(id, { status: 'suspended', kickoff_at: SAME_DAY });
    await set(id, { status: 'timed', kickoff_at: NEXT_DAY });
    assert.equal((await fixture(id)).void_reason, 'rescheduled');
  });

  await test('an abandoned match requiring a replay is void and the matchday completes; the replay changes nothing', async () => {
    const ids = await seed(admin, { entries: 2, rulesVersion: 2 });
    const id = ids.fixtures[0].id;
    await set(id, { status: 'abandoned', home_score: 1, away_score: 0 });
    const held = await rescore(ids);
    assert.equal(held.after.matchday.status, 'scoring', 'abandoned is held until the provider says what happens next');
    assert.equal((await fixture(id)).voided_at, null);

    await set(id, { status: 'timed', home_score: null, away_score: null, kickoff_at: NEXT_DAY });
    assert.equal((await fixture(id)).void_reason, 'abandoned');
    const settled = await rescore(ids);
    assert.equal(settled.after.matchday.status, 'completed');
    assert.deepEqual(scores(settled.after), [VOID_HOME_WIN_SCORE, VOID_HOME_WIN_SCORE]);

    await set(id, { status: 'finished', home_score: 2, away_score: 0, kickoff_at: new Date(Date.now() - 3600_000).toISOString() });
    const replayed = await rescore(ids);
    assert.deepEqual(scores(replayed.after), scores(settled.after));
  });

  await test('an abandoned match scheduled again is a confirmed replay: void at once, even before its kickoff is rewritten', async () => {
    const ids = await seed(admin, { entries: 2, rulesVersion: 2 });
    const id = ids.fixtures[0].id;
    const kickoff = (await fixture(id)).kickoff_at;
    await set(id, { status: 'abandoned', home_score: 1, away_score: 0 });
    assert.equal((await fixture(id)).voided_at, null, 'abandoned alone is held');
    // Who You Got's result polls never rewrite kickoff_at, so a replay first shows as the old kickoff with a scheduled status.
    await set(id, { status: 'timed', home_score: null, away_score: null });
    assert.equal((await fixture(id)).void_reason, 'abandoned');
    assert.deepEqual((await fixture(id)).kickoff_at, kickoff);
    const { after } = await rescore(ids);
    assert.equal(after.matchday.status, 'completed');
    assert.deepEqual(scores(after), [VOID_HOME_WIN_SCORE, VOID_HOME_WIN_SCORE]);
  });

  await test('an abandoned match whose result stands is scored', async () => {
    const ids = await seed(admin, { entries: 1, rulesVersion: 2 });
    await set(ids.fixtures[0].id, { status: 'abandoned', home_score: 1, away_score: 0 });
    await set(ids.fixtures[0].id, { status: 'finished', home_score: 2, away_score: 1 });
    const { after } = await rescore(ids);
    assert.equal(after.matchday.status, 'completed');
    assert.deepEqual(scores(after), [FULL_SCORE]);
    assert.equal((await fixture(ids.fixtures[0].id)).voided_at, null);
  });

  await test('genuine score corrections to non-voided fixtures still recalculate, beside a voided fixture', async () => {
    const ids = await seedWithPendingFirst();
    await set(ids.fixtures[0].id, { status: 'postponed' });
    const base = await rescore(ids);
    // fixtures[1] is the away_win pick, 2-1 to the home side: -5. A correction to 1-2 makes it +10 + 1.
    await set(ids.fixtures[1].id, { home_score: 1, away_score: 2 });
    const corrected = await rescore(ids);
    assert.equal(corrected.after.matchday.status, 'completed');
    assert.deepEqual(scores(corrected.after), scores(base.after).map(s => s + 16));
    await set(ids.fixtures[1].id, { home_score: 2, away_score: 1 });
    assert.deepEqual(scores((await rescore(ids)).after), scores(base.after));
  });

  await test('repeated identical syncs are no-ops: the decision, revisions and rows do not change', async () => {
    const ids = await seedWithPendingFirst();
    const id = ids.fixtures[0].id;
    await set(id, { status: 'postponed' });
    await set(id, { status: 'timed', kickoff_at: NEXT_DAY });
    await rescore(ids);
    const voidedAt = (await fixture(id)).voided_at;
    const before = await snapshot(db, ids.matchday);
    for (let i = 0; i < 3; i++) {
      await set(id, { status: 'timed', kickoff_at: NEXT_DAY });
      await set(id, { last_synced_at: new Date().toISOString() });
    }
    assert.deepEqual((await fixture(id)).voided_at, voidedAt);
    const after = await snapshot(db, ids.matchday);
    assert.equal(after.matchday.scoring_revision, before.matchday.scoring_revision);
    assert.equal(after.matchday.sync_revision, before.matchday.sync_revision);
    const again = await score(db, ids, after.matchday.scoring_revision);
    assert.equal(again.reused, true);
  });

  await test('a void is irreversible and can not be written by clients', async () => {
    const ids = await seedWithPendingFirst(1);
    const id = ids.fixtures[0].id;
    await set(id, { status: 'postponed' });
    const voided = await fixture(id);
    await set(id, { voided_at: null, void_reason: null });
    assert.deepEqual(await fixture(id), { ...voided, updated_at: (await fixture(id)).updated_at });
    await set(id, { void_reason: 'manual' });
    assert.equal((await fixture(id)).void_reason, 'postponed');

    await admin.query("set request.jwt.claim.role='authenticated'");
    try {
      await set(ids.fixtures[1].id, { voided_at: new Date().toISOString(), void_reason: 'manual' });
    } finally { await admin.query("set request.jwt.claim.role='service_role'"); }
    assert.equal((await fixture(ids.fixtures[1].id)).voided_at, null, 'a non-service role can not set the decision');
  });

  await test('void_pick8_fixture is the owner\'s explicit tool: service role only, idempotent, and final', async () => {
    const ids = await seed(admin, { entries: 1, rulesVersion: 2 });
    const id = ids.fixtures[0].id;
    await set(id, { status: 'suspended' });
    const first = (await db.query('select public.void_pick8_fixture($1) as r', [id])).rows[0].r;
    assert.equal(first.alreadyVoided, false);
    assert.equal(first.reason, 'manual');
    const second = (await db.query('select public.void_pick8_fixture($1) as r', [id])).rows[0].r;
    assert.equal(second.alreadyVoided, true);
    assert.equal(second.voidedAt, first.voidedAt);
    const { after } = await rescore(ids);
    assert.equal(after.matchday.status, 'completed');

    const outsider = await cluster.connect(false);
    await outsider.query("set role authenticated; set request.jwt.claim.role='authenticated'");
    await assert.rejects(outsider.query('select public.void_pick8_fixture($1)', [id]), error => error.code === '42501');
    await assert.rejects(db.query('select public.void_pick8_fixture($1)', ['00000000-0000-0000-0000-000000000000']), error => error.code === '22023');
  });

  await test('a void fixture does not hold a matchday for its new date; an ordinary pending fixture still does', async () => {
    const ids = await seedWithPendingFirst(1);
    await set(ids.fixtures[0].id, { status: 'postponed' });
    await set(ids.fixtures[0].id, { status: 'timed', kickoff_at: NEXT_DAY });
    assert.equal((await rescore(ids)).after.matchday.status, 'completed');

    const pending = await seedWithPendingFirst(1);
    const held = await rescore(pending);
    assert.equal(held.result.finalScoringReady, false, 'an upcoming, undecided fixture holds the matchday');
    assert.equal(held.after.matchday.status, 'scoring');
    // cancelled is void-by-status but not decided: the provider may still correct it, so its future slot still holds the matchday.
    await set(pending.fixtures[0].id, { status: 'cancelled' });
    assert.equal((await fixture(pending.fixtures[0].id)).voided_at, null);
    await assert.rejects(score(db, pending, (await snapshot(db, pending.matchday)).matchday.scoring_revision),
      error => /cannot be completed before every configured kickoff/.test(error.message));
  });

  await test('discovery treats a voided fixture as terminal and ignores its new date', async () => {
    const ids = await seedWithPendingFirst(1);
    await set(ids.fixtures[0].id, { status: 'postponed' });
    await set(ids.fixtures[0].id, { status: 'timed', kickoff_at: NEXT_DAY });
    await rescore(ids);
    const work = (await db.query("select public.discover_pick8_due_work('results', now(), 12) as work")).rows[0].work;
    const matchday = work.matchdays.find(m => m.id === ids.matchday) ?? (await db.query("select public.discover_pick8_due_work('reconciliation', now(), 12) as work")).rows[0].work.matchdays.find(m => m.id === ids.matchday);
    assert.ok(matchday, 'matchday is discoverable');
    assert.equal(matchday.allTerminal, true);
    assert.deepEqual(matchday.voidedExternalFixtureIds, [ids.fixtures[0].external_fixture_id]);
    assert.ok(Date.parse(matchday.lastKickoffAt) < Date.now(), 'the voided fixture\'s 2099 kickoff does not set the cadence window');
  });

  await test('manual and accelerated-test matchdays are unaffected', async () => {
    const ids = await seed(admin, { entries: 1, manual: true });
    await set(ids.fixtures[0].id, { status: 'postponed' });
    assert.equal((await fixture(ids.fixtures[0].id)).voided_at, null);
  });

  await test('the SQL decision matches its TypeScript mirror over every status and kickoff move, whatever the lock state', async () => {
    const ids = await seed(admin, { entries: 1, rulesVersion: 2 });
    // One matchday whose deadline has passed (its anchor kicked off two days ago) and one that is still open.
    const lockedMd = (await admin.query("insert into public.matchdays(season_id,matchday_number,status,fixture_sync_mode,pick8_rules_version) values($1,20,'open','provider',2) returning id", [ids.season])).rows[0].id;
    await admin.query("insert into public.fixtures(matchday_id,external_fixture_id,home_team_name,away_team_name,kickoff_at,status) values($1,'anchor-locked','Anchor H','Anchor A',now()-interval '2 days','finished')", [lockedMd]);
    const openMd = await (async () => {
      const md = (await admin.query("insert into public.matchdays(season_id,matchday_number,status,fixture_sync_mode,pick8_rules_version) values($1,21,'open','provider',2) returning id", [ids.season])).rows[0].id;
      await admin.query("insert into public.fixtures(matchday_id,external_fixture_id,home_team_name,away_team_name,kickoff_at,status) values($1,'anchor-open','Anchor H','Anchor A','2098-01-01T12:00:00Z','timed')", [md]);
      return md;
    })();
    const base = Date.parse('2099-03-14T15:00:00Z');
    const moves = [0, 3 * 3600_000, 24 * 3600_000, -24 * 3600_000, 9 * 3600_000];
    const previousStatuses = ['scheduled', 'timed', 'in_play', 'paused', 'finished', 'suspended', 'abandoned', 'cancelled'];
    const nextStatuses = ['timed', 'postponed', 'finished', 'in_play', 'suspended', 'abandoned', 'cancelled'];
    let n = 0, voided = 0;
    for (const [locked, md] of [[true, lockedMd], [false, openMd]]) {
      for (const previous of previousStatuses) for (const next of nextStatuses) for (const move of moves) {
        const external = `grid-${n++}`;
        await admin.query("insert into public.fixtures(matchday_id,external_fixture_id,home_team_name,away_team_name,kickoff_at,status) values($1,$2,$3,'Grid A',$4,$5)",
          [md, external, `Grid H ${n}`, new Date(base).toISOString(), previous]);
        await admin.query('update public.fixtures set status=$2, kickoff_at=$3 where external_fixture_id=$1', [external, next, new Date(base + move).toISOString()]);
        const row = (await admin.query('select void_reason from public.fixtures where external_fixture_id=$1', [external])).rows[0];
        const expected = decideFixtureVoid({
          previous: { status: previous, kickoff_at: new Date(base).toISOString() },
          next: { status: next, kickoff_at: new Date(base + move).toISOString() },
        });
        assert.equal(row.void_reason, expected, `${locked ? 'locked' : 'open'} ${previous} -> ${next} ${move / 3600_000}h`);
        if (expected) voided++;
      }
    }
    assert.ok(voided > 20 && voided < n, 'the grid exercises both outcomes');
    // A delay that crosses midnight in London is a different calendar day, in summer time as well.
    for (const [from, to, reason] of [
      ['2099-07-01T22:30:00Z', '2099-07-02T00:00:00Z', 'rescheduled'],
      ['2099-07-01T15:00:00Z', '2099-07-01T22:30:00Z', null],
      ['2099-12-01T23:30:00Z', '2099-12-02T00:30:00Z', 'rescheduled'],
    ]) {
      const external = `edge-${from}`;
      await admin.query("insert into public.fixtures(matchday_id,external_fixture_id,home_team_name,away_team_name,kickoff_at,status) values($1,$2,$3,'Edge A',$4,'timed')", [lockedMd, external, `Edge H ${from}`, from]);
      await admin.query("update public.fixtures set kickoff_at=$2 where external_fixture_id=$1", [external, to]);
      const row = (await admin.query('select void_reason from public.fixtures where external_fixture_id=$1', [external])).rows[0];
      assert.equal(row.void_reason, reason, `${from} -> ${to}`);
      assert.equal(decideFixtureVoid({ previous: { status: 'timed', kickoff_at: from }, next: { status: 'timed', kickoff_at: to } }), reason);
    }
  });

  // ---- 14 day expiry of suspended / abandoned fixtures ----
  const DAY = 24 * 3600_000;
  const settle = async (client, at) => (await client.query('select public.settle_expired_pick8_interrupted_fixtures($1) as r', [at])).rows[0].r;
  const candidates = async (at) => (await db.query("select public.discover_pick8_due_work('results', $1, 12) as work", [at])).rows[0].work.expiredInterruptedFixtureCount;
  async function seedInterrupted(status, kickoffAt, entries = 2) {
    const ids = await seed(admin, { entries, rulesVersion: 2 });
    await set(ids.fixtures[0].id, { status, home_score: 1, away_score: 0, kickoff_at: kickoffAt });
    return ids;
  }

  for (const status of ['suspended', 'abandoned']) {
    await test(`${status} for 14 days is voided by the settlement; the matchday completes on the rest and nothing else moves`, async () => {
      const kickoff = new Date(Date.now() - 20 * DAY);
      const ids = await seedInterrupted(status, kickoff.toISOString());
      const id = ids.fixtures[0].id;
      const held = await rescore(ids);
      assert.equal(held.after.matchday.status, 'scoring');
      const justBefore = new Date(kickoff.getTime() + 14 * DAY - 1000).toISOString();
      const exactly = new Date(kickoff.getTime() + 14 * DAY).toISOString();
      assert.equal(await candidates(justBefore), 0);
      assert.equal((await settle(db, justBefore)).count, 0);
      assert.equal((await fixture(id)).voided_at, null, 'one second short of 14 days: still held');
      assert.equal(await candidates(exactly), 1, 'discovery names the candidate');

      const before = await snapshot(db, ids.matchday);
      const settled = await settle(db, exactly);
      assert.equal(settled.count, 1);
      assert.equal(settled.voided[0].fixtureId, id);
      const row = await fixture(id);
      assert.equal(row.void_reason, 'expired');
      assert.ok(row.voided_at);
      const flagged = await snapshot(db, ids.matchday);
      assert.equal(flagged.matchday.scoring_pending, true, 'the matchday is flagged for scoring');
      assert.equal(flagged.matchday.fixture_application_pending, true);
      assert.ok(flagged.matchday.scoring_revision > before.matchday.scoring_revision);
      assert.equal(await candidates(exactly), 0);

      const done = await rescore(ids);
      assert.equal(done.result.finalScoringReady, true);
      assert.equal(done.after.matchday.status, 'completed');
      assert.equal(done.result.voidSelections, 2);
      assert.ok(done.after.selections.filter(s => s.fixture_id === id).every(s => s.points_awarded === null));
      assert.deepEqual(scores(done.after), [VOID_HOME_WIN_SCORE, VOID_HOME_WIN_SCORE], 'its goals are excluded from Total Goals');
    });
  }

  await test('the settlement is idempotent and the SQL window matches the TypeScript rule', async () => {
    const kickoff = new Date(Date.now() - 30 * DAY);
    const ids = await seedInterrupted('suspended', kickoff.toISOString(), 1);
    const id = ids.fixtures[0].id;
    for (const [offset, status] of [[-1, 'suspended'], [0, 'suspended'], [1, 'abandoned']]) {
      const at = kickoff.getTime() + 14 * DAY + offset;
      assert.equal(isInterruptedFixtureExpired({ status, kickoff_at: kickoff.toISOString() }, at, 'scoring'), offset >= 0);
    }
    assert.equal((await settle(db, new Date().toISOString())).count, 1);
    const voidedAt = (await fixture(id)).voided_at;
    const revision = (await snapshot(db, ids.matchday)).matchday.scoring_revision;
    for (let i = 0; i < 3; i++) assert.equal((await settle(db, new Date().toISOString())).count, 0);
    assert.deepEqual((await fixture(id)).voided_at, voidedAt);
    assert.equal((await snapshot(db, ids.matchday)).matchday.scoring_revision, revision, 'repeat runs write nothing');
  });

  await test('after the expiry no provider update can reverse the void: a late resume, result or replay scores nothing', async () => {
    const ids = await seedInterrupted('suspended', new Date(Date.now() - 20 * DAY).toISOString());
    const id = ids.fixtures[0].id;
    await settle(db, new Date().toISOString());
    const base = await rescore(ids);
    const voidedAt = (await fixture(id)).voided_at;
    for (const update of [
      { status: 'in_play', home_score: 0, away_score: 0 },
      { status: 'finished', home_score: 7, away_score: 0 },
      { status: 'suspended', home_score: 1, away_score: 0 },
      { status: 'timed', home_score: null, away_score: null, kickoff_at: NEXT_DAY },
    ]) {
      await set(id, update);
      const { after, result } = await rescore(ids);
      assert.deepEqual((await fixture(id)).voided_at, voidedAt, JSON.stringify(update));
      assert.equal(after.matchday.status, 'completed');
      assert.equal(result.finalScoringReady, true);
      assert.deepEqual(scores(after), scores(base.after));
    }
  });

  await test('the expiry only touches held, undecided fixtures of matchdays that are not complete', async () => {
    const kickoff = new Date(Date.now() - 20 * DAY).toISOString();
    const now = new Date().toISOString();

    // Resumed or finished fixtures are not candidates, however old they are, and are scored normally.
    const resumed = await seedInterrupted('suspended', kickoff, 1);
    await set(resumed.fixtures[0].id, { status: 'finished', home_score: 2, away_score: 1 });
    assert.equal(await candidates(now), 0);
    assert.equal((await settle(db, now)).count, 0);
    const scored = await rescore(resumed);
    assert.equal(scored.after.matchday.status, 'completed');
    assert.deepEqual(scores(scored.after), [FULL_SCORE]);

    // Every other status is left to the provider.
    for (const status of ['timed', 'in_play', 'paused', 'postponed', 'cancelled']) {
      const ids = await seedInterrupted(status, kickoff, 1);
      const before = await fixture(ids.fixtures[0].id);
      await settle(db, now);
      const row = await fixture(ids.fixtures[0].id);
      assert.equal(row.voided_at, null, `${status} is left to the provider (the settlement decided nothing)`);
      assert.equal(before.void_reason, row.void_reason);
    }

    // A completed matchday keeps its scores: nothing in it is voided afterwards.
    const completed = await seedInterrupted('suspended', kickoff, 1);
    await admin.query("update public.matchdays set status='completed' where id=$1", [completed.matchday]);
    assert.equal(await candidates(now), 0);
    assert.equal((await settle(db, now)).count, 0);
    assert.equal((await fixture(completed.fixtures[0].id)).voided_at, null);

    // Manual and accelerated-test matchdays are not provider matchdays.
    const manual = await seed(admin, { entries: 1, manual: true });
    await set(manual.fixtures[0].id, { status: 'suspended', kickoff_at: kickoff });
    assert.equal((await settle(db, now)).count, 0);
    assert.equal((await fixture(manual.fixtures[0].id)).voided_at, null);
  });

  await test('an expired match in a matchday that still waits for a later fixture: the void is decided, the matchday keeps waiting', async () => {
    const ids = await seed(admin, { entries: 1, rulesVersion: 2 });
    await set(ids.fixtures[0].id, { status: 'suspended', kickoff_at: new Date(Date.now() - 20 * DAY).toISOString() });
    await set(ids.fixtures[9].id, { status: 'timed', home_score: null, away_score: null, kickoff_at: new Date(Date.now() + 3600_000).toISOString() });
    await settle(db, new Date().toISOString());
    assert.equal((await fixture(ids.fixtures[0].id)).void_reason, 'expired');
    const { result, after } = await rescore(ids);
    assert.equal(result.finalScoringReady, false, 'a fixture still to be played holds the matchday');
    assert.equal(after.matchday.status, 'scoring');
    assert.ok(after.entries.every(e => e.calculated_score === null));
  });

  await test('the settlement is a service-role tool; clients can not call it', async () => {
    const outsider = await cluster.connect(false);
    await outsider.query("set role authenticated; set request.jwt.claim.role='authenticated'");
    await assert.rejects(outsider.query('select public.settle_expired_pick8_interrupted_fixtures(now())'), error => error.code === '42501');
  });

  await test('the expiry holds after the provider has stopped checking: discovery and settlement need no provider data', async () => {
    const ids = await seedInterrupted('suspended', new Date(Date.now() - 20 * DAY).toISOString(), 1);
    // Whatever the provider cadence left behind, the candidate is found from local rows alone, by every policy.
    await admin.query("update public.matchdays set next_provider_check_at = now() + interval '100 days' where id=$1", [ids.matchday]);
    for (const policy of ['results', 'fixtures', 'reconciliation']) {
      const work = (await db.query('select public.discover_pick8_due_work($1, now(), 12) as work', [policy])).rows[0].work;
      assert.equal(work.expiredInterruptedFixtureCount, 1, policy);
    }
    assert.equal((await settle(db, new Date().toISOString())).count, 1);
    // Settling flags the matchday, so the very next discovery selects it for application and scoring without waiting on the provider.
    const work = (await db.query("select public.discover_pick8_due_work('results', now(), 12) as work")).rows[0].work;
    const matchday = work.matchdays.find(m => m.id === ids.matchday);
    assert.ok(matchday, 'the matchday is due');
    assert.equal(matchday.scoringPending, true);
    assert.equal(matchday.allTerminal, true);
    assert.deepEqual(matchday.voidedExternalFixtureIds, [ids.fixtures[0].external_fixture_id]);
    assert.equal(work.expiredInterruptedFixtureCount, 0);
  });
} finally { await cluster.close(); }
