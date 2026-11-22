import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { typeScriptModule } from './helpers/pick8-postgres.mjs';

const validation = typeScriptModule('utils/pick8-entry-validation.ts');
const rules = typeScriptModule('utils/pick8-rules.ts');
const categories = rules.getPick8Rules(2).categories;
function harness({ authorized = true, inactive = false, rpcError = false, scoringError = false } = {}) {
  const calls = { clients: 0, rpc: [], scored: [], paths: [] };
  const admin = {
    from(table) {
      const response = table === 'matchdays' ? { data: { season_id: 'season', pick8_rules_version: 2 }, error: null } : { data: categories.map((_,i)=>({id:`f${i}`})), error: null };
      const query = { select() { return query; }, eq() { return query; }, maybeSingle() { return Promise.resolve(response); }, then(resolve) { return Promise.resolve(response).then(resolve); } };
      return query;
    },
    rpc(name,args) { calls.rpc.push({name,args}); return { retry(value) { assert.equal(value,false); return Promise.resolve(rpcError ? {data:null,error:{code:'40001'}} : {data:{entry_id:'saved'},error:null}); } }; },
  };
  const loadedModule = { exports: {} };
  const require = id => ({
    'next/cache': { revalidatePath(path) { calls.paths.push(path); } },
    'next/navigation': { redirect(path) { throw Object.assign(new Error('redirect'),{path}); } },
    '@/utils/app-context': { async getRequestAuthContext() { return { user: authorized ? {id:'trusted-actor'} : null, profile: {is_admin:authorized,is_active:!inactive},requestDeadlineSignal:AbortSignal.timeout(1000) }; } },
    '@/utils/supabase/admin': { createInteractiveAdminClient() { calls.clients++; return admin; } },
    '@/utils/pick8-scoring': { async recalculateMatchdayScores(input) { calls.scored.push(input); if(scoringError) throw new Error('unavailable'); } },
    '@/utils/pick8-entry-validation': validation,
    '@/utils/pick8-rules': rules,
  })[id] ?? (()=>{throw new Error(`Unexpected import ${id}`);})();
  runInNewContext(ts.transpileModule(readFileSync(new URL('../app/(app)/admin/entries/actions.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:loadedModule,exports:loadedModule.exports,require,AbortSignal});
  const form = new FormData();
  for(const [key,value] of Object.entries({matchday_id:'matchday',player_id:'player',actor_id:'forged-actor',intent:'submit',confirm_admin_save:'on',admin_reason:'Player requested manual submission',total_goals:'28',allow_post_lock:'on'})) form.set(key,value);
  categories.forEach((category,i)=>{form.set(`fixture_category_f${i}`,category);form.set(`fixture_side_f${i}`,category==='away_win'?'away':'home');});
  return { calls, form, save:()=>loadedModule.exports.saveAdminPickEntry({ok:false,message:''},form) };
}

test('admin action denies ordinary, signed-out and inactive callers before privileged reads', async () => {
  for(const options of [{authorized:false},{inactive:true}]) {
    const h = harness(options); assert.equal((await h.save()).ok,false); assert.equal(h.calls.clients,0); assert.equal(h.calls.rpc.length,0);
  }
});
test('admin action validates reasons, categories, sides and Total Goals before writing', async () => {
  for(const [key,value] of [['admin_reason',''],['total_goals','101'],['total_goals','1.5'],['fixture_category_f0','btts'],['fixture_category_f0',''],['fixture_category_f0','invalid'],['fixture_side_f3','']]) {
    const h = harness(); h.form.set(key,value); assert.equal((await h.save()).ok,false); assert.equal(h.calls.rpc.length,0);
  }
});
test('admin submission uses authenticated actor, explicit late confirmation, and existing scorer', async () => {
  const h = harness();
  await assert.rejects(h.save(), e=>e.path==='/admin/entries?player=player&matchday=matchday&saved=1');
  const {name,args} = h.calls.rpc[0]; assert.equal(name,'admin_save_pick8_entry'); assert.equal(args.check_actor_id,'trusted-actor'); assert.equal(args.check_player_id,'player');
  assert.equal(args.check_expected_updated_at,null); assert.equal(args.check_allow_post_lock,true); assert.equal(args.check_selections.length,8);
  assert.equal(h.calls.scored.length,1); assert.ok(h.calls.paths.includes('/tables'));
});
test('admin correction passes optimistic version and preserves intent', async () => {
  const h = harness(); h.form.set('intent','save_changes'); h.form.set('expected_updated_at','2026-11-21T00:00:00.123456Z'); h.form.delete('allow_post_lock');
  await assert.rejects(h.save(),/redirect/);
  const args=h.calls.rpc[0].args; assert.equal(args.check_intent,'save_changes'); assert.equal(args.check_expected_updated_at,'2026-11-21T00:00:00.123456Z'); assert.equal(args.check_allow_post_lock,false);
});
test('admin draft remains draft and does not invoke scorer', async () => {
  const h = harness(); h.form.set('intent','draft'); h.form.set('total_goals',''); h.form.set('fixture_category_f0','');
  await assert.rejects(h.save(),/redirect/); assert.equal(h.calls.rpc[0].args.check_intent,'draft'); assert.equal(h.calls.scored.length,0);
});
test('unconfirmed save freezes editing and does not retry or score', async () => {
  const h = harness({rpcError:true}); const result = await h.save(); assert.equal(result.outcome,'unknown'); assert.equal(h.calls.rpc.length,1); assert.equal(h.calls.scored.length,0);
});
test('scoring failure reports committed audited entry with pending scoring', async () => {
  const h = harness({scoringError:true}); await assert.rejects(h.save(),e=>e.path.endsWith('saved=pending')); assert.equal(h.calls.rpc.length,1);
});

test('admin action requires explicit save confirmation before privileged access', async () => {
  const h = harness(); h.form.delete('confirm_admin_save');
  assert.equal((await h.save()).ok,false); assert.equal(h.calls.clients,0);
});
