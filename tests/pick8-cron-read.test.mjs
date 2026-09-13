import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createCronReadContext,runCronRead,boundCronMonitoring,CRON_READ_BUDGET_MS,CRON_READ_ATTEMPT_MS} from '../utils/supabase/cron-read.ts';
const ok={data:[{id:1}],error:null,status:200};
const fail=status=>({data:null,error:{message:'Gateway Timeout'},status});
const context=options=>createCronReadContext({log:()=>{},random:()=>0,...options});
function builder(work,method='GET',path='seasons') {
 return {method,url:new URL('https://example.test/rest/v1/'+path),retry(value){assert.equal(value,false);return this;},abortSignal(signal){this.signal=signal;return this;},then(resolve,reject){return Promise.resolve().then(()=>work(this.signal)).then(resolve,reject);}};
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(const status of [502,503,504]) test(`${status} retries once with fresh builders`,async()=>{
 let calls=0;const ctx=context();
 assert.equal(await runCronRead(ctx,'test',()=>builder(()=>++calls===1?fail(status):ok)),ok);
 assert.equal(calls,2);assert.equal(ctx.summary().retries,1);
});
for(const status of [400,401,403,404,429,500]) test(`${status} is not retried`,async()=>{
 let calls=0;const result=fail(status);
 assert.equal(await runCronRead(context(),'test',()=>builder(()=>{calls++;return result;})),result);assert.equal(calls,1);
});
test('SQL permissions and non-transient transport errors are not retried',async()=>{
 for(const error of [{code:'42501',message:'denied'},Object.assign(new TypeError('fetch failed'),{cause:{code:'CERT_HAS_EXPIRED'}})]) {
 let calls=0;await runCronRead(context(),'test',()=>builder(()=>{calls++;throw error;}));assert.equal(calls,1);
 }
});
test('approved transport failure retries and exhausted errors remain visible',async()=>{
 let calls=0;const ctx=context();
 const result=await runCronRead(ctx,'test',()=>builder(()=>{calls++;throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}});}));
 assert.equal(calls,2);assert.ok(result.error);assert.equal(ctx.summary().events.at(-1).outcome,'failed');
});
test('real SDK cannot multiply retries; Retry-After is respected',async()=>{
 const starts=[];const client=createClient('https://example.test','test-key',{global:{fetch:async()=>{starts.push(performance.now());return starts.length===1?new Response('{"message":"busy"}',{status:503,headers:{'Retry-After':'0.03'}}):new Response('[]',{status:200});}}});
 const result=await runCronRead(context(),'test',()=>client.from('seasons').select('id'));
 assert.equal(result.error,null);assert.equal(starts.length,2);assert.ok(starts[1]-starts[0]>=25);
});
test('Retry-After beyond remaining budget refuses retry',async()=>{
 let calls=0;const client=createClient('https://example.test','test-key',{global:{fetch:async()=>{calls++;return new Response('{"message":"busy"}',{status:504,headers:{'Retry-After':'60'}});}}});
 assert.equal((await runCronRead(context(),'test',()=>client.from('seasons').select('id'))).status,504);assert.equal(calls,1);
});
test('concurrency is at most three and invocation retries at most eight',async()=>{
 let active=0,peak=0,calls=0;const ctx=context();
 await Promise.all(Array.from({length:20},()=>runCronRead(ctx,'test',()=>builder(async()=>{calls++;active++;peak=Math.max(peak,active);await sleep(3);active--;return fail(504);})))) ;
 assert.equal(peak,3);assert.equal(calls,28);assert.equal(ctx.summary().retries,8);assert.equal(ctx.summary().events.length,24);assert.equal(ctx.summary().droppedEvents,4);
});
test('attempt timeout retries; absolute deadline cancels queued reads',async()=>{
 assert.equal(CRON_READ_BUDGET_MS,25000);assert.equal(CRON_READ_ATTEMPT_MS,6000);
 const keepAlive=setInterval(()=>{},100);
 try {
 const ctx=context({attemptMs:10,budgetMs:200});let calls=0;
 const result=await runCronRead(ctx,'test',()=>builder(signal=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}));
 assert.equal(calls,2);assert.equal(result.error.code,'cron_read_attempt_timeout');
 const deadline=context({budgetMs:20,attemptMs:100});let started=0;
 const results=await Promise.all(Array.from({length:6},()=>runCronRead(deadline,'test',()=>builder(()=>{started++;return new Promise(()=>{});})))) ;
 assert.equal(started,3);assert.ok(results.every(r=>r.error.code==='cron_read_deadline'));
 } finally {clearInterval(keepAlive);}
});
test('caller cancellation interrupts backoff and never starts next attempt',async()=>{
 const controller=new AbortController();let calls=0;
 const pending=runCronRead(context({signal:controller.signal,random:()=>1}),'test',()=>builder(()=>{calls++;return fail(504);}));
 setTimeout(()=>controller.abort(),10);assert.equal((await pending).error.code,'cron_read_cancelled');assert.equal(calls,1);
});
test('mutations, RPCs and reused builders cannot execute through runner',async()=>{
 let calls=0;
 for(const [method,path] of [['POST','seasons'],['GET','rpc/function']]) {
 assert.equal((await runCronRead(context(),'test',()=>builder(()=>{calls++;return ok;},method,path))).error.code,'cron_read_failed');
 }assert.equal(calls,0);
 const reused=builder(()=>{calls++;return fail(503);});await runCronRead(context(),'test',()=>reused);assert.equal(calls,1);
});
test('monitoring is single attempt and expired context prevents starting writes',async()=>{
 let calls=0;const ctx=context();
 assert.equal(await boundCronMonitoring(ctx,()=>builder(()=>{calls++;return fail(503);},'POST')).then(r=>r.status),503);assert.equal(calls,1);
 const controller=new AbortController();controller.abort();
 assert.throws(()=>boundCronMonitoring(context({signal:controller.signal}),()=>{calls++;return builder(()=>ok);}));assert.equal(calls,1);
});
test('attempt deadline includes stalled SDK response body',async()=>{
 let calls=0;const keepAlive=setInterval(()=>{},100);
 try {
 const client=createClient('https://example.test','test-key',{global:{fetch:async()=>{
 calls++;return {status:200,statusText:'OK',ok:true,headers:new Headers(),text:()=>new Promise(()=>{})};
 }}});
 const result=await runCronRead(context({attemptMs:10,budgetMs:200}),'test',()=>client.from('seasons').select('id'));
 assert.equal(calls,2);assert.equal(result.error.code,'cron_read_attempt_timeout');
 }finally{clearInterval(keepAlive);}
});
test('R and L share slots, but only R consumes the eight-retry allowance',async()=>{
 const ctx=context();let active=0,peak=0,calls=0;
 const results=await Promise.all(Array.from({length:20},(_,i)=>runCronRead(ctx,'mixed',()=>builder(async()=>{
 calls++;active++;peak=Math.max(peak,active);await sleep(2);active--;return fail(504);
 }),i<10?'R':'L')));
 assert.equal(peak,3);assert.equal(calls,28);assert.equal(ctx.summary().retries,8);
 assert.ok(results.every(result=>result.status===504));
});
test('queue time and request duration are independently measured',async()=>{
 let clock=0;const ctx=context({now:()=>clock});
 await ctx.acquire();await ctx.acquire();await ctx.acquire();
 const pending=runCronRead(ctx,'timing',()=>builder(()=>{clock+=11;return ok;}),'L');
 clock=37;ctx.release();await pending;ctx.release();ctx.release();
 const event=ctx.summary().events[0];
 assert.equal(event.queueMs,37);assert.equal(event.requestMs,11);assert.equal(event.elapsedMs,48);
 assert.equal(event.requestStarted,true);assert.equal(event.policy,'L');assert.equal(event.budgetRemainingMs,24952);
 assert.equal(ctx.summary().queueTotalMs,37);assert.equal(ctx.summary().requestTotalMs,11);
});
test('expiration while queued reports zero request time and does not start query',async()=>{
 const controller=new AbortController();let clock=0,calls=0;
 const ctx=context({signal:controller.signal,now:()=>clock});
 await ctx.acquire();await ctx.acquire();await ctx.acquire();
 const pending=runCronRead(ctx,'queued',()=>builder(()=>{calls++;return ok;}),'L');
 clock=100;controller.abort();await pending;ctx.release();ctx.release();ctx.release();
 const event=ctx.summary().events[0];
 assert.equal(calls,0);assert.equal(event.queueMs,100);assert.equal(event.requestMs,0);assert.equal(event.requestStarted,false);
});
test('backoff does not retain a slot needed by another read',async()=>{
 let retryLogged;const retried=new Promise(resolve=>{retryLogged=resolve;});
 const ctx=context({random:()=>1,log:event=>{if(event.outcome==='retry')retryLogged();}});
 await ctx.acquire();await ctx.acquire();let calls=0;
 const retrying=runCronRead(ctx,'retry',()=>builder(()=>++calls===1?fail(504):ok));
 await retried;
 const other=await runCronRead(ctx,'other',()=>builder(()=>ok),'L');
 assert.equal(other,ok);assert.equal(calls,1);ctx.release();ctx.release();await retrying;
});
test('single/maybeSingle body/request cancellation uses the same deadline',async()=>{
 const keepAlive=setInterval(()=>{},100);
 try{
 for(const terminal of ['single','maybeSingle']){
 let calls=0;
 const client=createClient('https://example.test','test-key',{global:{fetch:async(_url,init)=>{
 calls++;return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
 }}});
 const ctx=context({budgetMs:50,attemptMs:10});
 const result=await runCronRead(ctx,'terminal',()=>client.from('seasons').select('id')[terminal](),'L');
 assert.equal(calls,1);assert.equal(result.error.code,'cron_read_attempt_timeout');assert.equal(ctx.summary().events[0].requestStarted,true);
 }
 }finally{clearInterval(keepAlive);}
});
test('non-cron reads preserve original error handling and transport settings',async()=>{
 const {readForCron}=await import('../utils/supabase/cron-read.ts');
 const result=fail(504);let calls=0;
 const query={then(resolve,reject){calls++;return Promise.resolve(result).then(resolve,reject);},retry(){throw Error('Do not change non-cron retries');}};
 assert.equal(await readForCron(undefined,'R','outside',()=>query,true),result);assert.equal(calls,1);
});

test('repeated 504 exhausts exactly two attempts with original diagnostics', async () => {
  let calls = 0;
  const error = { code: '', message: 'Gateway Timeout', details: 'gateway detail', hint: 'try later' };
  const ctx = createCronReadContext({ random: () => 0, log: () => {} });
  const result = await runCronRead(ctx, 'discovery.fixtures', () => builder(() => {
    calls++; return { data: null, error, status: 504 };
  }));
  assert.equal(calls, 2);
  assert.equal(result.error, error);
  assert.equal(result.status, 504);
  const event = ctx.summary().events.at(-1);
  for (const key of ['code', 'message', 'details', 'hint']) assert.equal(event[key], error[key]);
  assert.equal(event.httpStatus, 504);
});

test('overlapping invocations isolate contexts and nested helpers reuse their parent', async () => {
  const { withCronReadContext, currentCronReadContext } = await import('../utils/supabase/cron-read.ts');
  const contexts = [];
  await Promise.all([1, 2].map(() => withCronReadContext(async () => {
    const parent = currentCronReadContext();
    contexts.push(parent);
    await sleep(1);
    await withCronReadContext(async () => assert.equal(currentCronReadContext(), parent));
  })));
  assert.notEqual(contexts[0], contexts[1]);
  assert.equal(currentCronReadContext(), undefined);
});

test('write transport performs one attempt and refuses work after deadline', async () => {
  const { cronDeadlineFetch } = await import('../utils/supabase/cron-read.ts');
  let calls = 0;
  const controller = new AbortController();
  const fetch = cronDeadlineFetch(context({ signal: controller.signal }), async () => {
    calls++; return new Response('timeout', { status: 504 });
  });
  assert.equal((await fetch('https://example.test/rest/v1/seasons', { method: 'PATCH' })).status, 504);
  assert.equal(calls, 1);
  controller.abort();
  assert.throws(() => fetch('https://example.test/rest/v1/seasons', { method: 'PATCH' }));
  assert.equal(calls, 1);
});

test('SQL and PostgREST validation codes are deterministic even behind a gateway status', async () => {
  for (const code of ['42501', 'P0001', '22023', 'PGRST204', 'PGRST116']) {
    let calls = 0;
    await runCronRead(context(), 'test', () => builder(() => {
      calls++; return { error: { code, message: 'deterministic error' }, status: 504 };
    }));
    assert.equal(calls, 1);
  }
});
