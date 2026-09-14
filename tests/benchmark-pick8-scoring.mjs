// Controlled SDK/network benchmark, real PostgreSQL and actual cron/scorer code.
// The local transport implements only the REST operations exercised here; it
// does not claim to measure a hosted PostgREST gateway or production latency.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import ts from 'typescript';
import { createTestDatabase, root, seed, snapshot } from './helpers/pick8-postgres.mjs';

const cluster = await createTestDatabase();
const db = await cluster.connect();
const baseline = '7d31a4e';
const latencyMs = Number(process.env.PICK8_BENCH_LATENCY_MS ?? 109);
const providerMs = Number(process.env.PICK8_BENCH_PROVIDER_MS ?? 1200);
const native = createRequire(import.meta.url);
const quote = name => { if (!/^[a-z_]+$/.test(name)) throw Error(`Unexpected identifier: ${name}`); return '"'+name+'"'; };

async function run(version, budgetMs) {
  const ids = await seed(cluster.admin);
  await db.query("update public.fixtures set status='timed',home_score=null,away_score=null where id=$1",[ids.fixtures[9].id]);
  // Mixed finished/timed results with status scoring, as in the incident.
  await db.query(`insert into public.competitions(season_id,name,start_matchday,end_matchday,status)
    select $1,'Competition '||i,1+(i-1)*5,least(i*5,38),case when i=1 then 'active' else 'upcoming' end from generate_series(1,8) i`,[ids.season]);
  await db.query("update public.seasons set competition_refresh_pending=false where id=$1", [ids.season]);
  const initial = await snapshot(db,ids.matchday);
  const provider = {matchday:4,fixtures:initial.fixtures.map(f=>({externalFixtureId:f.external_fixture_id,
    homeTeamId:f.home_team_id,awayTeamId:f.away_team_id,homeTeamName:f.home_team_name,awayTeamName:f.away_team_name,
    homeTeamCrestUrl:f.home_team_crest_url,awayTeamCrestUrl:f.away_team_crest_url,kickoffAt:f.kickoff_at,
    status:f.status,homeScore:f.home_score,awayScore:f.away_score}))};
  const calls=[]; const logs=[]; const modules=new Map();
  async function transport(input, init={}) {
    const url=new URL(String(input)); const method=init.method??'GET';
    const table=url.pathname.split('/').at(-1); calls.push({table,method});
    await delay(latencyMs,undefined,{signal:init.signal});
    try {
      if(url.pathname.includes('/rpc/')) {
        const a=JSON.parse(init.body);
        const data=(await db.query('select public.score_pick8_matchday($1,$2,$3,$4) as result',
          [a.check_season_id,a.check_matchday_id,a.check_scoring_revision,a.allow_accelerated_test_completion])).rows[0].result;
        return Response.json(data);
      }
      const parameters=[]; const filters=[];
      const param=value=>{parameters.push(value);return '$'+parameters.length;};
      for(const [key,value] of url.searchParams) {
        if(['select','order','limit','on_conflict','columns'].includes(key)) continue;
        if(value==='is.null') filters.push(`${quote(key)} is null`);
        else if(value==='not.is.null') filters.push(`${quote(key)} is not null`);
        else if(value.startsWith('eq.')) filters.push(`${quote(key)}=${param(value.slice(3))}`);
        else if(value.startsWith('in.(')) filters.push(`${quote(key)} in (${value.slice(4,-1).split(',').map(v=>param(v.replace(/^"|"$/g,''))).join(',')})`);
        else throw Error('Unsupported filter '+value);
      }
      const where=filters.length?' where '+filters.join(' and '):'';
      let query;
      if(method==='GET') {
        const columns=(url.searchParams.get('select')??'*').split(',').map(c=>c==='*'?'*':quote(c)).join(',');
        query=`select ${columns} from public.${quote(table)}${where}`;
        if(url.searchParams.has('order')) query+=' order by '+url.searchParams.get('order').split(',').map(o=>{const [col,dir]=o.split('.');return quote(col)+(dir==='desc'?' desc':' asc');}).join(',');
        if(url.searchParams.has('limit')) query+=' limit '+param(Number(url.searchParams.get('limit')));
      } else if(method==='PATCH') {
        const values=JSON.parse(init.body);
        query=`update public.${quote(table)} set ${Object.entries(values).map(([k,v])=>quote(k)+'='+param(v)).join(',')}${where} returning *`;
      } else if(method==='POST') {
        const body=JSON.parse(init.body); const rows=Array.isArray(body)?body:[body]; const keys=Object.keys(rows[0]);
        query=`insert into public.${quote(table)} (${keys.map(quote).join(',')}) values `+rows.map(r=>'('+keys.map(k=>param(r[k])).join(',')+')').join(',');
        if(url.searchParams.has('on_conflict')) query+=' on conflict ('+url.searchParams.get('on_conflict').split(',').map(quote).join(',')+') do update set '+keys.map(k=>quote(k)+'=excluded.'+quote(k)).join(',');
        query+=' returning *';
      } else throw Error('Unsupported method '+method);
      const result=await db.query(query,parameters);
      // PostgREST emits bigint as a JSON number; node-postgres returns a string.
      for (const field of result.fields) if (field.dataTypeID===20) {
        for (const row of result.rows) if (row[field.name]!==null) row[field.name]=Number(row[field.name]);
      }
      const accept=new Headers(init.headers).get('accept')??'';
      return Response.json(accept.includes('vnd.pgrst.object')?(result.rows[0]??null):result.rows);
    } catch(error) {return Response.json({message:error.message,code:error.code??'test_error',details:'',hint:''},{status:400});}
  }
  function load(file) {
    const path=resolve(root,file); if(modules.has(path)) return modules.get(path);
    const loaded={exports:{}};modules.set(path,loaded.exports);
    let source=version==='old'?execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8'}):readFileSync(path,'utf8');
    // Only the full-pass baseline is uncapped; also measure the real 25s failure.
    if(file==='utils/supabase/cron-read.ts') source=source.replace('CRON_READ_BUDGET_MS = 25_000','CRON_READ_BUDGET_MS = '+budgetMs);
    const require=id=>{
      if(id==='server-only') return {};
      if(id==='next/server') return {NextResponse:Response};
      if(id==='@/utils/supabase/admin') return {createAdminClient:()=>{
        const context=load('utils/supabase/cron-read.ts').currentCronReadContext();
        return createClient('http://local-test.invalid','local-test-key',{auth:{persistSession:false},global:{fetch:(input,init)=>{
          context?.signal.throwIfAborted();
          const signal=context?(init?.signal?AbortSignal.any([context.signal,init.signal]):context.signal):init?.signal;
          return transport(input,{...init,signal});
        }}});
      }};
      return id.startsWith('@/')?load(id.slice(2)+'.ts'):native(id);
    };
    runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
      {module:loaded,exports:loaded.exports,require,Date,Map,Set,URL,AbortSignal,performance,crypto:globalThis.crypto,setTimeout,clearTimeout,
        process:{env:{WHO_YOU_GOT_API_URL:'http://provider-test.invalid',WHO_YOU_GOT_API_KEY:'test'}},
        console:{info:v=>logs.push(JSON.parse(v)),error:v=>logs.push(JSON.parse(v))},
        fetch:async(_input,init)=>{await delay(providerMs,undefined,{signal:init?.signal});return Response.json(provider);}}, {filename:path});
    return loaded.exports;
  }
  const cron=load('utils/pick8-cron-automation.ts');
  const start=performance.now(); let response,error;
  try{response=await cron.runConditionalResultSync();}catch(e){error=e.message;}
  const durationMs=performance.now()-start;
  const after=await snapshot(db,ids.matchday);
  const scoring=logs.find(l=>l.stage==='scoring'&&!l.skipped);
  const rowChanges=(table)=>after[table].filter(row=>row.updated_at!==initial[table].find(r=>r.id===row.id)?.updated_at).length;
  const result={version,budgetMs,latencyMs,providerMs,supabaseRequests:calls.length,
    selectionPatchRequests:calls.filter(c=>c.table==='entry_selections'&&c.method==='PATCH').length,
    entryPatchRequests:calls.filter(c=>c.table==='entries'&&c.method==='PATCH').length,
    scoringDurationMs:scoring?.durationMs,totalCronDurationMs:Math.round(durationMs),ok:response?.ok??false,error,
    selectionRowsConsidered:182,entryRowsConsidered:26,selectionRowsWritten:rowChanges('selections'),entryRowsWritten:rowChanges('entries'),
    selectionOutputValuesChanged:after.selections.filter(s=>{const old=initial.selections.find(x=>x.id===s.id);return s.points_awarded!==old.points_awarded||s.is_correct!==old.is_correct;}).length,
    entryOutputValuesChanged:after.entries.filter(e=>{const old=initial.entries.find(x=>x.id===e.id);return e.calculated_score!==old.calculated_score||e.score_calculated_at!==old.score_calculated_at;}).length,
    scoringResult:after.matchday.scoring_result,scoringPending:after.matchday.scoring_pending,syncPending:after.matchday.sync_pending};
  console.log(JSON.stringify(result));
  if(version==='new' || budgetMs===60_000) assert.equal(response?.ok,true,JSON.stringify(response??error));
  if(version==='new') {
    assert.equal(calls.filter(c=>c.table==='score_pick8_matchday').length,1);
    calls.length=0;
    const fastStart=performance.now();
    const fast=await cron.runConditionalResultSync();
    assert.equal(fast.successes[0].sync.fastPath,true);
    assert.equal(fast.successes[0].recalculated,false);
    assert.equal(calls.length,6);
    const unchanged=await snapshot(db,ids.matchday);
    assert.deepEqual(unchanged.selections,after.selections); assert.deepEqual(unchanged.entries,after.entries);
    console.log(JSON.stringify({version:'new-fast-path',supabaseRequests:calls.length,totalCronDurationMs:Math.round(performance.now()-fastStart),status:unchanged.matchday.status,rowsChanged:0}));
  }
}
try {
  await run('old',60_000);
  await run('new',25_000);
  if(process.env.PICK8_BENCH_SKIP_CAPPED!=='1') await run('old',25_000);
}finally{await cluster.close();}
