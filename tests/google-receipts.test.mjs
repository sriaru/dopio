import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
test('only trusted server receipts can confirm sends; results stay private and invalid receipts roll back',async()=>{
 const db=new PGlite();try{
 const actor=randomUUID(),other=randomUUID(),attempt=randomUUID(),mail=randomUUID();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;`);
 await db.query('insert into auth.users values($1),($2)',[actor,other]);
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 const as=async(u)=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${u}',false);set role authenticated;`);
 await as(actor);const w=(await db.query("select save_workspace_onboarding('Manager','Artist Manager','','1–2','Workspace',true) id")).rows[0].id;
 await db.query("select save_chat_message($1,$2,0,'to@example.com','Subject','Body')",[w,mail]);
 await db.query('select claim_chat_message($1,$2,1,$3)',[w,mail,attempt]);
 const receipt=(who=actor,provider='provider-id',outcome='accepted')=>db.query("select record_google_send_result('chat',$1,$2,$3,$4,$5)",[w,who,attempt,provider,outcome]);
 await assert.rejects(receipt());await assert.rejects(db.query("select finish_chat_message($1,$2,'forged')",[w,attempt]));
 await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role service_role");
 await assert.rejects(receipt(other));await assert.rejects(receipt(actor,''));
 await receipt(actor,null,'unknown');await receipt();await assert.rejects(receipt());
 await as(actor);assert.equal((await db.query('select status,provider_id from chat_messages where id=$1',[mail])).rows[0].status,'sent');
 assert.equal((await db.query('select * from google_send_results')).rows.length,2);
 await as(other);assert.equal((await db.query('select * from google_send_results')).rows.length,0);
 await db.exec('reset role');await db.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'manager')",[w,other]);
 const imp=async(u)=>{
 await as(u);const c=(await db.query("insert into gmail_connections(workspace_id,user_id,email,encrypted_refresh_token) values($1,$2,'shared@example.com','encrypted-token-placeholder') returning connection_id",[w,u])).rows[0].connection_id;
 const query=()=>db.query("select import_gmail_message($1,$2,'same-provider-id','Sender','Subject','Body','2026-10-14') id",[w,c]);
 const first=(await query()).rows[0].id;assert.equal((await query()).rows[0].id,first);return first;
 };
 const first=await imp(actor),second=await imp(other);assert.notEqual(first,second);
 assert.equal((await db.query('select id from inbox_messages where id=$1',[first])).rows.length,0);
 // Persisted partial Calendar results are restricted and tied to the live lease.
 await as(actor);const c=randomUUID(),lease=randomUUID();
 await db.query("insert into calendar_connections(workspace_id,user_id,connection_id,email,encrypted_refresh_token) values($1,$2,$3,'manager@example.com','encrypted-token-placeholder')",[w,actor,c]);
 await db.query('select claim_calendar_sync($1,$2,$3)',[w,c,lease]);
 const run=(status,count=0)=>db.query('select record_calendar_run($1,$2,$3,$4,$5,$6,0)',[lease,w,actor,c,status,count]);
 await assert.rejects(run('running'));
 await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role service_role");
 await run('running');await run('partial',1);await assert.rejects(run('confirmed',2));
 await as(actor);assert.equal((await db.query('select confirmed_events from google_calendar_runs')).rows[0].confirmed_events,1);
 await as(other);assert.equal((await db.query('select * from google_calendar_runs')).rows.length,0);

 }finally{await db.close();}
});
