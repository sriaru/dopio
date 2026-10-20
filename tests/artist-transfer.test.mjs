import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID as uuid} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
test('targeted transfer preserves linked records, grants owner and manager access, and safely repeats',async()=>{
 const db=new PGlite();try{
 const owner=uuid(),alex=uuid(),outsider=uuid();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;`);
 for(const id of [owner,alex,outsider])await db.query('insert into auth.users values($1)',[id]);
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 const as=async id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`);
 await as(owner);const dst=(await db.query("select save_workspace_onboarding('Srinithi','Artist Manager','','1–2','Company',true) id")).rows[0].id;
 await as(alex);const src=(await db.query("select save_workspace_onboarding('Alex','Artist Manager','','1–2','Personal',true) id")).rows[0].id;
 const ids=[];for(const name of ['MAYA','NOAH','RIVER'])ids.push((await db.query('insert into artists(workspace_id,name) values($1,$2) returning record_id',[src,name])).rows[0].record_id);
 const r=(await db.query("insert into releases(workspace_id,artist_id,title,release_date) values($1,$2,'Single','2026-12-01') returning id",[src,ids[0]])).rows[0].id;
 const t=(await db.query("insert into tasks(workspace_id,artist_id,release_id,title,due_date) values($1,$2,$3,'Master','2026-11-01') returning id",[src,ids[0],r])).rows[0].id;
 await db.query('select post_artist_update($1,$2,$3,$4,$5)',[src,ids[0],uuid(),'Ready',[]]);
 await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)");
 await db.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'manager')",[dst,alex]);
 let sql=await readFile('supabase/repairs/move_alex_artist_team.sql','utf8');
 for(const [old,value] of [['715ceb2b-a82d-4e32-8bea-95dd2e7cb057',src],['03cb5c5d-a424-4660-be39-f837d424e619',dst],...['acca015c-9c5f-4d3e-83b2-dcc5e9def12f','b0b2ee1a-5e18-4726-9465-a54c90ebd0cc','360b3003-26f7-4bfb-8218-e4e4bbeb9801'].map((v,i)=>[v,ids[i]])])sql=sql.replaceAll(old,value);
 const before=(await db.query('select conname,condeferrable,condeferred from pg_constraint order by oid')).rows;
 // A dependent email draft must stop the entire operation.
 await db.query("insert into task_email_drafts(id,workspace_id,task_id,recipient,subject,body) values($1,$2,$3,'test@example.com','Test','Body')",[uuid(),src,t]);
 await assert.rejects(db.exec(sql),/separate transfer review/);await db.exec('rollback');
 assert.equal((await db.query('select workspace_id from artists where record_id=$1',[ids[0]])).rows[0].workspace_id,src);
 await db.query('delete from task_email_drafts where task_id=$1',[t]);
 await db.query("insert into calendar_connections(workspace_id,user_id,connection_id,email) values($1,$2,$3,'test@example.com')",[src,alex,uuid()]);
 for(const state of ["calendar_id='google-calendar'","creation_started=true","lease_until=now()+interval '5 minutes'"]){
 await db.exec('update calendar_connections set '+state);
 await assert.rejects(db.exec(sql),/Calendar sync state/);await db.exec('rollback');
 await db.exec('update calendar_connections set calendar_id=null,creation_started=false,lease_until=null');
 }
 await db.query("insert into google_calendar_runs(id,workspace_id,actor_id,connection_id,status) values($1,$2,$3,$4,'partial')",[uuid(),src,alex,uuid()]);
 await assert.rejects(db.exec(sql),/Calendar sync state/);await db.exec('rollback');
 await db.query('delete from google_calendar_runs where workspace_id=$1',[src]);
 await db.exec(sql);await db.exec(sql);
 assert.equal((await db.query('select workspace_id from calendar_connections')).rows[0].workspace_id,src);
 assert.deepEqual((await db.query('select conname,condeferrable,condeferred from pg_constraint order by oid')).rows,before);
 assert.equal((await db.query('select workspace_id from tasks where id=$1',[t])).rows[0].workspace_id,dst);
 assert.equal((await db.query("select count(*) n from artist_updates where kind='message'")).rows[0].n,1);
 for(const user of [owner,alex]){await as(user);assert.equal((await db.query('select record_id from artists where workspace_id=$1',[dst])).rows.length,3);assert.equal((await db.query('select artist_conversation($1,$2) f',[dst,ids[0]])).rows[0].f.updates.find(u=>u.kind==='message').body,'Ready');}
 await as(outsider);await assert.rejects(db.query('select artist_conversation($1,$2)',[dst,ids[0]]));
 }finally{await db.close();}
});
