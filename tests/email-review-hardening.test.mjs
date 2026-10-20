import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

test('persisted email review: approval, rejection, stale context, isolation, dedupe and atomic failure',async()=>{
 const db=new PGlite();try{
 await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;");
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 const owner=randomUUID(),other=randomUUID();
 await db.query('insert into auth.users values($1,$2),($3,$4)',[owner,'owner@example.com',other,'other@example.com']);
 const as=async id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`);
 await as(other);const foreign=(await db.query("select save_workspace_onboarding('Other','Artist Manager','','1–2','Other',true) id")).rows[0].id;
 await as(owner);const w=(await db.query("select save_workspace_onboarding('Owner','Artist Manager','','1–2','Review',true) id")).rows[0].id;
 const a=(await db.query("insert into artists(workspace_id,name) values($1,'Daniel') returning record_id id",[w])).rows[0].id;
 const r=(await db.query("insert into releases(workspace_id,artist_id,title,release_date,format) values($1,$2,'Daybreak','2026-12-20','Album') returning id",[w,a])).rows[0].id;
 const t=(await db.query("insert into tasks(workspace_id,artist_id,release_id,title,due_date) values($1,$2,$3,'Mastering','2026-11-01') returning id",[w,a,r])).rows[0].id;
 async function source(body){return (await db.query("select import_ai_email($1,'sender@example.com','Change',$2,null,null,null,'','Saved source') id",[w,body])).rows[0].id;}
 async function propose(kind,body,date){const m=await source(body);const target=kind==='task'?t:r;const table=kind==='task'?'tasks':'releases';const v=(await db.query(`select version from ${table} where id=$1`,[target])).rows[0].version;
 if(kind==='task')await db.query("select save_gmail_analysis($1,$2,0,$3,$4,$5,$6,'Selected saved task')",[w,m,target,v,date,body]);
 else await db.query('select propose_email_release($1,$2,$3,$4,$5,$6)',[w,m,target,v,date,body]);
 const proposals=kind==='task'?'deadline_proposals':'release_email_proposals';return {m,id:(await db.query(`select id from ${proposals} where message_id=$1`,[m])).rows[0].id};}
 const decide=async(kind,id,approve=true)=>(await db.query(kind==='task'?'select decide_deadline_proposal($1,$2) status':'select decide_email_release($3,$1,$2) status',kind==='task'?[id,approve]:[id,approve,w])).rows[0].status;
 const date=async()=>(await db.query('select due_date::text d from tasks where id=$1',[t])).rows[0].d;
 const unrelated=await source('Lunch is ready.');
 await assert.rejects(db.query('select propose_email_release($1,$2,$3,1,$4,$5)',[w,unrelated,r,'2026-12-30','Lunch is ready.']),/source quote/);
 assert.equal((await db.query('select count(*)::int n from release_email_proposals where message_id=$1',[unrelated])).rows[0].n,0);
 const first=await propose('task','Move Daniel Mastering to November 10, 2026.','2026-11-10');
 assert.equal(await source('Move Daniel Mastering to November 10, 2026.'),first.m);
 assert.equal(await decide('task',first.id),'approved');assert.equal(await date(),'2026-11-10');
 const system=(await db.query('select * from artist_updates where record_id=$1',[t])).rows;assert.equal(system.length,1);assert.equal(system[0].actor_id,owner);assert.equal(system[0].new_date.toISOString().slice(0,10),'2026-11-10');
 const version=(await db.query('select version from tasks where id=$1',[t])).rows[0].version;
 assert.equal(await decide('task',first.id),'approved');assert.equal((await db.query('select version from tasks where id=$1',[t])).rows[0].version,version);
 assert.equal((await db.query('select * from artist_updates where record_id=$1',[t])).rows.length,1);
 const rejected=await propose('task','Please move Mastering to November 11, 2026.','2026-11-11');
 assert.equal(await decide('task',rejected.id,false),'rejected');assert.equal(await decide('task',rejected.id),'rejected');assert.equal(await date(),'2026-11-10');
 const stale=await propose('task','Please move Mastering to November 12, 2026.','2026-11-12');
 await db.query("update releases set title='Daybreak updated' where id=$1",[r]);
 assert.equal(await decide('task',stale.id),'conflict');assert.equal(await date(),'2026-11-10');
 const conflict=await propose('task','Move Mastering to December 25, 2026.','2026-12-25');
 assert.equal(await decide('task',conflict.id),'conflict');assert.equal(await date(),'2026-11-10');
 const release=await propose('release','Move Daybreak to December 30, 2026.','2026-12-30');
 await as(other);assert.equal((await db.query('select * from release_email_proposals where id=$1',[release.id])).rows.length,0);
 await assert.rejects(db.query('select decide_email_release($1,$2,true)',[foreign,release.id]));
 await assert.rejects(db.query('select decide_deadline_proposal($1,true)',[first.id]));
 await as(owner);
 // Inject audit failure after the release update: the complete statement must roll back.
 await db.exec("reset role;create function public.test_audit_failure() returns trigger language plpgsql as $$begin if new.action='approved' then raise exception 'injected audit failure';end if;return new;end$$;create trigger test_failure before insert on public.workspace_activity for each row execute function public.test_audit_failure();");
 await as(owner);await assert.rejects(decide('release',release.id),/injected audit failure/);
 assert.equal((await db.query('select release_date::text d from releases where id=$1',[r])).rows[0].d,'2026-12-20');
 assert.equal((await db.query('select status from release_email_proposals where id=$1',[release.id])).rows[0].status,'pending');
 assert.equal((await db.query('select * from artist_updates where record_id=$1',[r])).rows.length,0);
 await db.exec('reset role;drop trigger test_failure on public.workspace_activity;');await as(owner);
 assert.equal(await decide('release',release.id),'approved');assert.equal(await decide('release',release.id),'approved');
 assert.equal((await db.query("select count(*)::int n from workspace_activity where entity_id=$1 and action='approved'",[release.id])).rows[0].n,1);
 assert.equal((await db.query('select * from artist_updates where record_id=$1',[r])).rows.length,1);
 assert.equal((await db.query('select count(*)::int n from task_email_sends')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from calendar_connections')).rows[0].n,0);
 }finally{await db.close();}
});
