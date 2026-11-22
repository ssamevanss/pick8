import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { typeScriptModule } from './helpers/pick8-postgres.mjs';

const native = createRequire(import.meta.url);
const matchdays = [
  {id:'past',matchday_number:10,status:'completed',locks_at:'2026-11-01T12:00:00Z'},
  {id:'current',matchday_number:11,status:'scoring',locks_at:'2026-11-21T12:00:00Z'},
  {id:'next',matchday_number:12,status:'upcoming',locks_at:null},
];
export function harness({ authorized=true, days=matchdays, empty=false, season=true, entryPage=false }={}) {
  const reads=[];
  const profiles=[{id:'player',display_name:'Test Player',is_active:true,pick8_participation_active:true}];
  function from(table) {
    const filters={};
    const query={
      select(){return query;},eq(key,value){filters[key]=value;return query;},order(){return query;},
      async maybeSingle(){return response(true);},then(resolve,reject){return Promise.resolve(response()).then(resolve,reject);},
    };
    function response(single=false) {
      reads.push({table,filters:{...filters}});
      let data;
      if(table==='profiles')data=single?profiles[0]:profiles;
      if(table==='seasons')data=season?{id:'active-season',name:'Test season'}:null;
      if(table==='matchdays')data=single?days.find(d=>d.id===filters.id):days;
      if(table==='entries')data=single?null:filters.matchday_id==='past'?[{user_id:'player',submitted_at:'2026-11-01T00:00:00Z'}]:filters.matchday_id==='next'?[{user_id:'player',submitted_at:null}]:[];
      if(table==='fixtures')data=empty?[]:[{id:'fixture'}];
      return {data,error:null,count:empty?0:10};
    }
    return query;
  }
  const redirect=path=>{throw Object.assign(new Error('redirect'),{path});};
  const mocks={
    'next/link':{default:({href,children,...props})=>React.createElement('a',{href,...props},children)},
    'next/navigation':{redirect},
    '@/utils/app-context':{async getRequestAuthContext(){return {supabase:{from},user:{id:'actor'},profile:{is_admin:authorized,is_active:true},requestDeadlineSignal:AbortSignal.timeout(1000)};}},
    '@/utils/supabase/admin':{createAdminClient(){assert.ok(authorized);return {from};},createInteractiveAdminClient(){assert.ok(authorized);return {from};}},
    './profile-actions':{updateProfile(){}},
    '@/components/forms/SubmitButton':{default:()=>null},
    '@/components/admin/CronHealthSection':{default:()=>null},
    '@/utils/pick8-cron-executions-store':{async loadCronHealth(){return null;}},
    '@/utils/pick8-admin-status':typeScriptModule('utils/pick8-admin-status.ts'),
    '@/utils/pick8-standings':typeScriptModule('utils/pick8-standings.ts'),
    '@/components/picks/MatchdaySelectNavigation':{default:({currentMatchday,matchdays})=>React.createElement('select',{value:currentMatchday,onChange(){}},matchdays.map(m=>React.createElement('option',{key:m.number,value:m.number},m.label)))},
    '@/components/picks/MatchdayEntryForm':{default:()=>React.createElement('form',{'data-entry-form':true})},
    '@/utils/pick8-rules':typeScriptModule('utils/pick8-rules.ts'),
    '@/utils/pick8-entry-validation':typeScriptModule('utils/pick8-entry-validation.ts'),
    '@/utils/pick8-fixture-state':typeScriptModule('utils/pick8-fixture-state.ts'),
    '@/utils/pick8-scoring':{calculateCompletedMatchdayGoalTotal(){return null;},isMatchdayReadyForFinalScoring(){return false;}},
    '@/utils/pick8-scoring-rules':typeScriptModule('utils/pick8-scoring-rules.ts'),
    './actions':{saveAdminPickEntry(){}},
  };
  const loadedModule={exports:{}};
  const file=entryPage?'app/(app)/admin/entries/page.tsx':'app/(app)/admin/page.tsx';
  const source=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  runInNewContext(source,{module:loadedModule,exports:loadedModule.exports,require(id){const mocked=mocks[id];if(mocked){if("default" in mocked)mocked.__esModule=true;return mocked;}return native(id);},console,Date,AbortSignal});
  return {reads,async render(params={}){return renderToStaticMarkup(await loadedModule.exports.default({searchParams:Promise.resolve(params)}));}};
}

test('admin selector defaults to current round and includes past/current/upcoming active-season matchdays',async()=>{
  const h=harness();const html=await h.render();
  assert.match(html,/Matchday 11 · Scoring/);
  for(const n of [10,11,12])assert.match(html,new RegExp(`value="${n}"`));
  assert.match(html,/value="11" selected=""/);
  assert.match(html,/player=player&amp;matchday=current/);assert.match(html,/Enter picks/);
  assert.ok(h.reads.some(r=>r.table==='matchdays'&&r.filters.season_id==='active-season'));
});
test('completed round refreshes submission status and all entry links',async()=>{
  const h=harness();const html=await h.render({matchday:'10'});
  assert.match(html,/Matchday 10 · Completed/);assert.match(html,/View \/ correct picks/);
  assert.match(html,/player=player&amp;matchday=past/);assert.doesNotMatch(html,/matchday=current/);
  assert.ok(h.reads.some(r=>r.table==='entries'&&r.filters.matchday_id==='past'));
});
test('upcoming round supports draft status and selection-specific links',async()=>{
  const h=harness();const html=await h.render({matchday:'12'});
  assert.match(html,/Matchday 12 · Upcoming/);assert.match(html,/Draft/);
  assert.match(html,/player=player&amp;matchday=next/);
});
test('unpopulated round keeps statuses visible and disables entry actions',async()=>{
  const h=harness({empty:true});const html=await h.render({matchday:'12'});
  assert.match(html,/Fixtures have not been populated/);assert.match(html,/Awaiting fixtures/);
  assert.match(html,/Test Player/);assert.doesNotMatch(html,/href="\/admin\/entries/);
});
test('invalid and out-of-season requests safely fall back to the current active-season round',async()=>{
  for(const matchday of ['missing-season-id','999','11x','-1',['10','12']]){
    const h=harness();const html=await h.render({matchday});assert.match(html,/value="11" selected=""/);
    assert.ok(h.reads.some(r=>r.table==='entries'&&r.filters.matchday_id==='current'));
  }
});
test('all-completed seasons and unpopulated future-only seasons still have a usable default',async()=>{
  assert.match(await harness({days:[matchdays[0]]}).render(),/Matchday 10 · Completed/);
  assert.match(await harness({days:[matchdays[2]],empty:true}).render(),/Matchday 12 · Upcoming/);
});
test('no active season or no matchdays produces a clear empty state',async()=>{
  assert.match(await harness({season:false}).render(),/There is no active Pick8 season/);
  assert.match(await harness({days:[]}).render(),/There are no matchdays in the active season/);
});
test('non-admin selector and direct entry requests are rejected before data reads',async()=>{
  for(const entryPage of [false,true]){
    const h=harness({authorized:false,entryPage});
    await assert.rejects(h.render({matchday:'10'}),e=>e.path==='/dashboard?error=Admin+access+required');
    assert.equal(h.reads.length,0);
  }
});
test('direct entry link for a round without fixtures gives a clear message and preserves return selection',async()=>{
  const h=harness({entryPage:true,empty:true});const html=await h.render({player:'player',matchday:'next'});
  assert.match(html,/Test Player · Matchday 12/);assert.match(html,/Fixtures have not been populated/);
  assert.match(html,/href="\/admin\?matchday=12"/);assert.doesNotMatch(html,/data-entry-form/);
});
