// Opt-in: isolated PostgreSQL + real form in Chromium. No production URL/credentials accepted.
// PICK8_PG_TEST_DEPENDENCIES=/path/to/pg-deps PICK8_UI_TEST_DEPENDENCIES=/path/to/playwright-esbuild node tests/pick8-admin-entry-browser.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createTestDatabase, seed, snapshot, score, root, typeScriptModule } from './helpers/pick8-postgres.mjs';

const dependencies = createRequire(join(process.env.PICK8_UI_TEST_DEPENDENCIES,'package.json'));
const { build } = dependencies('esbuild');
const { chromium } = dependencies('playwright');
const directory = mkdtempSync(join(tmpdir(),'pick8-admin-browser-'));
const cluster = await createTestDatabase();
const db = await cluster.connect();
const ids = await seed(cluster.admin,{entries:0,rulesVersion:2,future:true,status:'timed',home:null,away:null});
async function person(name,isAdmin=false) {
  const id=(await cluster.admin.query("insert into auth.users(id,email) values(gen_random_uuid(),gen_random_uuid()||'@test.invalid') returning id")).rows[0].id;
  await cluster.admin.query('update public.profiles set display_name=$2,is_admin=$3,is_active=true,pick8_participation_active=true where id=$1',[id,name,isAdmin]);return id;
}
const actor=await person('Test Administrator',true), player=await person('Test Player'), ordinary=await person('Ordinary Player');
let currentActor=actor;
await cluster.admin.query("update public.matchdays set status='open' where id=$1",[ids.matchday]);
const adapter={
  from(table) {
    assert.ok(['matchdays','fixtures'].includes(table));let id;
    const q={select(){return q;},eq(column,value){assert.equal(column,table==='fixtures'?'matchday_id':'id');id=value;return q;},
      async maybeSingle(){const result=await db.query(`select * from public.${table} where id=$1`,[id]);return {data:result.rows[0],error:null};},
      then(resolve,reject){return db.query('select id from public.fixtures where matchday_id=$1',[id]).then(r=>({data:r.rows,error:null})).then(resolve,reject);}};return q;
  },
  rpc(name,args){assert.equal(name,'admin_save_pick8_entry');return {async retry(value){assert.equal(value,false);try {const r=await db.query('select public.admin_save_pick8_entry($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[args.check_actor_id,args.check_player_id,args.check_expected_updated_at,args.check_reason,args.check_allow_post_lock,args.check_matchday_id,args.check_intent,args.check_total_goals,JSON.stringify(args.check_selections)]);return {data:r.rows[0].value,error:null};}catch(e){return {data:null,error:{code:e.code}};}}};},
};
const loadedModule={exports:{}};
const mocks={
  'next/navigation':{redirect(path){throw Object.assign(new Error('redirect'),{path});}},'next/cache':{revalidatePath(){}},
  '@/utils/app-context':{async getRequestAuthContext(){return {user:{id:currentActor},profile:{is_admin:currentActor===actor,is_active:true},requestDeadlineSignal:AbortSignal.timeout(20000)};}},
  '@/utils/supabase/admin':{createInteractiveAdminClient(){return adapter;}},
  '@/utils/pick8-scoring':{async recalculateMatchdayScores(){const state=await snapshot(db,ids.matchday);return score(db,ids,state.matchday.scoring_revision);}},
  '@/utils/pick8-entry-validation':typeScriptModule('utils/pick8-entry-validation.ts'),
  '@/utils/pick8-rules':typeScriptModule('utils/pick8-rules.ts'),
};
runInNewContext(ts.transpileModule(readFileSync(join(root,'app/(app)/admin/entries/actions.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:loadedModule,exports:loadedModule.exports,require(id){assert.ok(mocks[id],id);return mocks[id];},AbortSignal});
const source=`import React from 'react'; import {createRoot} from 'react-dom/client'; import Form from '${root}/components/picks/MatchdayEntryForm.tsx';
const state=await fetch('/state').then(r=>r.json());
createRoot(document.getElementById('root')).render(<main style={{maxWidth:1000,margin:'auto',padding:16}}><h1>Test Player · Matchday 4</h1><Form {...state} saveAction={async (_,form)=>{const r=await fetch('/save',{method:'POST',body:form}).then(r=>r.json());if(r.redirect){location.reload();return {ok:false,message:''};}return r;}} /></main>);`;
const built=await build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,format:'esm',write:false,jsx:'automatic',nodePaths:[join(root,'node_modules')],plugins:[{name:'test-action',setup(b){b.onResolve({filter:/^@\/app\/\(app\)\/my-picks\/actions$/},()=>({path:'dummy-action',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export async function savePickEntry(){throw Error("Explicit test action required")}',loader:'js'}));b.onResolve({filter:/^@\//},args=>({path:[join(root,args.path.slice(2)),join(root,args.path.slice(2)+'.ts'),join(root,args.path.slice(2)+'.tsx')].find(p=>existsSync(p))}));}}]});
const bundle=built.outputFiles[0].text;
const cssDirectory=join(root,'.next/static/chunks');
const css=existsSync(cssDirectory)?readdirSync(cssDirectory).filter(f=>f.endsWith('.css')).map(f=>readFileSync(join(cssDirectory,f),'utf8')).join('\n'):'';
const server=createServer(async(req,res)=>{try{
  if(req.url==='/styles.css'){res.setHeader('content-type','text/css');res.end(css);return;}
  if(req.url==='/bundle.js'){res.setHeader('content-type','application/javascript');res.end(bundle);return;}
  if(req.url==='/state'){
    const state=await snapshot(db,ids.matchday), entry=state.entries.find(e=>e.user_id===player);
    res.setHeader('content-type','application/json');res.end(JSON.stringify({matchdayId:ids.matchday,rulesVersion:2,reloadHref:'/',locksAt:state.matchday.locks_at,fixtures:state.fixtures.map(f=>({id:f.id,homeTeamName:f.home_team_name,awayTeamName:f.away_team_name,homeTeamCrestUrl:null,awayTeamCrestUrl:null,kickoffAt:f.kickoff_at,status:f.status,homeScore:f.home_score,awayScore:f.away_score})),initialSelections:state.selections.filter(s=>s.entry_id===entry?.id).map(s=>({category:s.category,fixtureId:s.fixture_id,selectedTeamSide:s.selected_team_side,pointsAwarded:s.points_awarded})),initialTotalGoals:entry?.total_goals_prediction??null,initiallyEditable:true,initiallySubmitted:Boolean(entry?.submitted_at),initiallySubmittedAt:entry?.submitted_at??null,initiallyHasEntry:Boolean(entry),actualGoals:null,finalReady:false,finalMatchdayScore:null,totalGoalsPoints:null,adminContext:{playerId:player,playerName:'Test Player',expectedUpdatedAt:entry?.updated_at??null,postLock:state.matchday.status==='scoring'}}));return;
  }
  if(req.url==='/save'){
    const form=await new Request('http://localhost/save',{method:'POST',headers:req.headers,body:Readable.toWeb(req),duplex:'half'}).formData();
    let result;try{result=await loadedModule.exports.saveAdminPickEntry({},form);}catch(e){if(!e.path)throw e;result={redirect:e.path};}res.setHeader('content-type','application/json');res.end(JSON.stringify(result));return;
  }
  res.setHeader('content-type','text/html');res.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
}catch(e){console.error(e);res.statusCode=500;res.end(String(e));}});
let browser;
try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror',e=>console.error(e));
  await page.goto(url);await page.getByText('Acting on behalf of Test Player.').waitFor();
  // Match the labels from the actual metadata, not a second copy of the UI rules.
  const rules=typeScriptModule('utils/pick8-rules.ts');const required=rules.getPick8Rules(2).categories;
  for(let i=0;i<required.length;i++){
    await page.locator('button[role=combobox]').nth(i).click();await page.getByRole('option',{name:rules.PICK8_CATEGORY_METADATA[required[i]].label,exact:true}).click();
    const row=page.locator('button[role=combobox]').nth(i).locator('..').locator('..');
    if(rules.PICK8_CATEGORY_METADATA[required[i]].needsTeam)await row.locator('select').selectOption('home');
  }
  await page.getByRole('spinbutton').fill('28');
  await page.getByRole('button',{name:'Submit Picks',exact:true}).click();
  assert.equal((await snapshot(db,ids.matchday)).entries.length,0,'reason/confirmation must block writes');
  await page.getByLabel('Reason for this change').fill('On behalf of the test player');
  await page.getByLabel('I have checked these picks').check();
  await page.getByRole('button',{name:'Submit Picks',exact:true}).click();
  await page.getByRole('button',{name:'Edit submission',exact:true}).waitFor();
  let state=await snapshot(db,ids.matchday);assert.equal(state.selections.length,8);assert.equal(state.entries[0].total_goals_prediction,28);
  console.log('PASS mobile: complete eight picks, required reason/confirmation, actual action -> SQL submission');
  await cluster.admin.query("update public.fixtures set kickoff_at=now()-interval '1 day',status='finished',home_score=2,away_score=1 where matchday_id=$1",[ids.matchday]);
  await cluster.admin.query("update public.matchdays set status='scoring' where id=$1",[ids.matchday]);
  await page.reload();await page.getByRole('button',{name:'Edit submission',exact:true}).click();
  await page.getByRole('spinbutton').fill('30');await page.getByLabel('Reason for this change').fill('Authorised retrospective correction');await page.getByLabel('I have checked these picks').check();
  await page.getByRole('button',{name:'Save edited submission',exact:true}).click();
  assert.equal((await snapshot(db,ids.matchday)).entries[0].total_goals_prediction,28,'late checkbox must block save');
  await page.getByLabel('I authorise this post-deadline change.').check();
  await page.getByRole('button',{name:'Save edited submission',exact:true}).click();
  await page.getByRole('button',{name:'Edit submission',exact:true}).waitFor();
  state=await snapshot(db,ids.matchday);assert.equal(state.entries[0].total_goals_prediction,30);assert.equal(state.matchday.scoring_pending,false);
  const audits=(await db.query('select * from public.pick8_entry_admin_audit order by recorded_at')).rows;
  assert.equal(audits.length,2);assert.equal(audits[1].actor_id,actor);assert.equal(audits[1].player_id,player);assert.equal(audits[1].before_value.entry.total_goals_prediction,28);assert.equal(audits[1].after_value.entry.total_goals_prediction,30);assert.equal(audits[1].post_lock,true);
  console.log('PASS late correction: explicit warning/confirmation, audit actor/player/before/after, scoring acknowledged');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile form must not overflow horizontally');
  await page.screenshot({path:join(directory,'mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:join(directory,'desktop.png'),fullPage:true});
  currentActor=ordinary;
  const form=new FormData();form.set('confirm_admin_save','on');form.set('matchday_id',ids.matchday);form.set('player_id',player);
  const denied=await fetch(url+'/save',{method:'POST',body:form}).then(r=>r.json());assert.equal(denied.ok,false);assert.match(denied.message,/administrator/);
  assert.equal((await db.query('select count(*) n from public.pick8_entry_admin_audit')).rows[0].n,'2');
  console.log('PASS direct action request: non-admin rejected, no writes');
  console.log(`Browser evidence: ${directory}`);
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));await cluster.close();}
