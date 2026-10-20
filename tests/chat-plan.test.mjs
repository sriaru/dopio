import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const source=ts.transpile(await readFile('lib/ai/release-plan.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
const {validatePlan}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('draft questions are allowed but incomplete or invalid plans cannot be approved',()=>{
 const p={artist_id:null,artist_name:'Daniel',genre:'Pop',title:'',format:'Album',date:'',tasks:[],question:'What is the album title and full release date?'};
 assert.deepEqual(validatePlan(p),p);
 assert.throws(()=>validatePlan(p,true));
 const ready={...p,title:'Daybreak',date:'2026-11-05',question:'',tasks:[{title:'Artwork',due_date:'2026-10-15'}]};
 assert.deepEqual(validatePlan(ready,true),ready);
 for(const date of ['2026-02-30','11/05','2026-12-01']) assert.throws(()=>validatePlan({...ready,tasks:[{title:'Artwork',due_date:date}]},true));
});
test('chat approval is atomic, workspace scoped, and idempotent',async()=>{
 const db=new PGlite();
 try {
 const alice='11111111-1111-4111-8111-111111111111';
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;insert into auth.users values('${alice}');`);
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 await db.exec(`select set_config('request.jwt.claim.sub','${alice}',false);set role authenticated;`);
 const w=(await db.query("select save_workspace_onboarding('Alice','Artist Manager','','1–2','Workspace',true) id")).rows[0].id;
 const tasks=JSON.stringify([{title:'Artwork',due_date:'2026-10-15'}]);
 const save=async(request,name='Daniel',artist=null,taskList=tasks,workspace=w)=>(await db.query("select create_chat_release_plan($1,$2,$3,$4,'Pop','Daybreak','2026-11-05',$5,'Album') id",[workspace,request,artist,name,taskList])).rows[0].id;
 const request='33333333-3333-4333-8333-333333333333';
 const id=await save(request);assert.equal(await save(request),id);
 assert.equal((await db.query('select count(*)::int n from artists')).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from tasks')).rows[0].n,1);
 const other='44444444-4444-4444-8444-444444444444';
 await assert.rejects(save(other));
 await assert.rejects(save(other,'River',null,JSON.stringify([{title:'Bad',due_date:'2026-12-01'}])));
 assert.equal((await db.query('select count(*)::int n from artists')).rows[0].n,1);
 await assert.rejects(save(other,'River',null,tasks,other));
 const artist=(await db.query('select record_id from artists')).rows[0].record_id;
 await save(other,'Daniel',artist);
 assert.equal((await db.query('select count(*)::int n from artists')).rows[0].n,1);
 await db.exec('reset role;set role anon');await assert.rejects(save(request));
 } finally {await db.close();}
});
