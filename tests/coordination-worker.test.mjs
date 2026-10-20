import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {randomUUID as uuid} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const require=createRequire(import.meta.url);
function loadModule(file,fetcher,cache=new Map()){
 const absolute=path.resolve(file);if(cache.has(absolute))return cache.get(absolute);
 const exports={};cache.set(absolute,exports);
 const source=ts.transpileModule(readFileSync(absolute,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const env={NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only',OPENAI_API_KEY:'test-only',GOOGLE_GMAIL_CLIENT_ID:'test-only',GOOGLE_GMAIL_CLIENT_SECRET:'test-only',GOOGLE_GMAIL_REDIRECT_URI:'http://localhost:3003/gmail/callback',GMAIL_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('hex'),COORDINATION_DEMO_EMAILS:'manager@example.com,producer@example.com'};
 vm.runInNewContext(source,{exports,require:name=>name==='server-only'?{}:name.startsWith('@/')?loadModule(name.slice(2)+'.ts',fetcher,cache):name.startsWith('.')?loadModule(path.join(path.dirname(absolute),name)+'.ts',fetcher,cache):require(name),process:{env},fetch:fetcher,Buffer,URL,URLSearchParams,AbortSignal,TextDecoder,Date,console});return exports;
}
function databaseAdapter(db){
 return {rpc:async(name,args={})=>{try{const entries=Object.entries(args);const q=await db.query('select * from public.'+name+'('+entries.map(([k],i)=>k+'=> $'+(i+1)).join(',')+')',entries.map(([,v])=>v));const value=q.rows[0];return {error:null,data:q.rows.length===1&&Object.keys(value).length===1?Object.values(value)[0]:['claim_coordination'].includes(name)?q.rows:value};}catch(error){return {error:{message:error.message},data:null};}},from(table){let columns='*',filters=[],params=[],order='',limit='',single=false;const q={select(c){columns=c;return q;},eq(k,v){params.push(v);filters.push((k.includes('->>')?k.replace('->>',"->>'")+"'":k)+'=$'+params.length);return q;},is(k){filters.push(k+' is null');return q;},in(k,values){if(!values.length)filters.push('false');else{const slots=values.map(v=>{params.push(v);return '$'+params.length;});filters.push(k+' in('+slots.join(',')+')');}return q;},order(k,o={}){order=' order by '+k+(o.ascending===false?' desc':' asc');return q;},limit(n){limit=' limit '+n;return q;},single(){single=true;return q;},maybeSingle(){single=true;return q;},then(resolve,reject){return db.query('select '+columns+' from '+table+(filters.length?' where '+filters.join(' and '):'')+order+limit,params).then(r=>({data:single?r.rows[0]??null:r.rows,error:null}),e=>({data:null,error:{message:e.message}})).then(resolve,reject);}};return q;}};
}
test('production worker processes evidence, waits for approval, sends a threaded email, then receives a file without falsely verifying it',async()=>{
 const db=new PGlite();try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;");
 const owner=uuid();await db.query('insert into auth.users values($1)',[owner]);
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);set role authenticated;`);
 const workspace=(await db.query("select save_workspace_onboarding('Owner','Artist Manager','','1–2','Company',true) id")).rows[0].id;
 const artist=(await db.query("insert into artists(workspace_id,name) values($1,'Maya Chen') returning record_id",[workspace])).rows[0].record_id;
 const release=(await db.query("insert into releases(workspace_id,artist_id,title,release_date) values($1,$2,'After Hours','2026-11-20') returning id",[workspace,artist])).rows[0].id;
 await db.query("insert into tasks(workspace_id,artist_id,release_id,title,due_date) values($1,$2,$3,'Final master','2026-11-13')",[workspace,artist,release]);
 const connection=uuid();let phase='delay',sendCalls=0;const received=Date.now()+3600000;
 const message=id=>({id,threadId:'thread1',internalDate:String(id==='reply'?received:received-7200000),payload:{mimeType:'multipart/mixed',headers:[{name:'From',value:'Producer <producer@example.com>'},{name:'Subject',value:'Maya Chen / After Hours — final master'},{name:'Message-ID',value:'<'+id+'@example.com>'}],parts:[{mimeType:'text/plain',body:{data:Buffer.from(id==='reply'?'Here is the final master.':'The master will arrive November 23, 2026.').toString('base64url')}},...(id==='reply'?[{mimeType:'audio/wav',filename:'AfterHours_final.wav',body:{attachmentId:'attachment1',size:1024}}]:[])]}});
 const fetcher=async(url,init={})=>{
  if(String(url).includes('oauth2.googleapis'))return Response.json({access_token:'test-only'});
  if(String(url).includes('api.openai.com')){const input=JSON.parse(JSON.parse(init.body).input),project=input.projects.find(p=>p.id===release),d=project.deliverables[0];return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({project_id:release,deliverable_id:d.id,confidence:.99,kind:input.email.id==='reply'?'received':'delay',promised_date:input.email.id==='reply'?null:'2026-11-23',evidence:input.email.body,summary:input.email.id==='reply'?'Master received':'Master delivery is late',consequence:'Distributor submission depends on the master.',severity:'high',steps:['Request an expedited master','Review the received file'],draft:'Can you deliver the master by November 13?',attachment_ids:input.email.id==='reply'?['attachment1']:[]})}]}]});}
  const u=new URL(url);
  if(u.pathname.endsWith('/messages/send')){sendCalls++;const outgoing=JSON.parse(init.body);assert.equal(outgoing.threadId,'thread1');const mime=Buffer.from(outgoing.raw,'base64url').toString();assert.match(mime,/In-Reply-To: <initial@example.com>/);assert.match(mime,/To: producer@example.com/);return Response.json({id:'sent1',threadId:'thread1'});}
  if(u.pathname.endsWith('/threads/thread1'))return Response.json({messages:[{id:'initial'},...(phase==='reply'?[{id:'reply'}]:[])]});
  if(u.pathname.endsWith('/messages'))return Response.json({messages:phase==='reply'?[{id:'reply'},{id:'initial'}]:[{id:'initial'}]});
  if(u.pathname.includes('/messages/'))return Response.json(message(u.pathname.split('/').pop()));
  throw new Error('Unexpected external request');
 };
 const security=loadModule('lib/gmail/security.ts',fetcher);
 const encrypted=security.seal('fixture-refresh-token',`gmail:${workspace}:${owner}:${connection}:manager@example.com`,Buffer.alloc(32,1));
 await db.query("insert into gmail_connections(workspace_id,user_id,connection_id,email,encrypted_refresh_token,can_send) values($1,$2,$3,'manager@example.com',$4,true)",[workspace,owner,connection,encrypted]);
 const runId=(await db.query('select configure_coordination($1,$2,$3,true,24) id',[workspace,release,['producer@example.com']])).rows[0].id;
 const d=(await db.query('select id from coordination_deliverables where run_id=$1',[runId])).rows[0].id;await db.query('select set_coordination_requirements($1,$2)',[d,['wav']]);
 const worker=loadModule('lib/coordination/worker.ts',fetcher),adapter=databaseAdapter(db);
 async function tick(){await db.exec('reset role');await db.query('update coordination_runs set next_run_at=now(),lease_until=null where id=$1',[runId]);const run=(await db.query('select * from claim_coordination()')).rows[0];return worker.processRun(adapter,run);}
 assert.equal((await tick()).ok,true);assert.equal(sendCalls,0);
 let a=(await db.query('select * from coordination_actions')).rows[0];assert.equal(a.status,'draft');
 assert.equal((await tick()).ok,true);assert.equal((await db.query('select * from coordination_actions')).rows.length,1);assert.equal(sendCalls,0);
 await db.exec('set role authenticated');await db.query('select review_coordination_action($1,$2,$3,true)',[a.id,a.version,'Please expedite the final master by November 13.']);
 assert.equal((await tick()).ok,true);assert.equal(sendCalls,1);
 assert.equal((await tick()).ok,true);assert.equal(sendCalls,1);
 phase='reply';assert.equal((await tick()).ok,true);
 assert.equal((await db.query('select status from coordination_actions where id=$1',[a.id])).rows[0].status,'responded');
 assert.equal((await db.query('select status from coordination_deliverables where id=$1',[d])).rows[0].status,'received');
 assert.equal((await db.query('select status from coordination_blockers')).rows[0].status,'awaiting_review');
 assert.equal(sendCalls,1);
 await db.exec('set role authenticated');await db.query('select verify_coordination_deliverable($1,true)',[d]);assert.equal((await db.query('select status from coordination_blockers')).rows[0].status,'resolved');
 }finally{await db.close();}
});
