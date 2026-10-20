import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const source=ts.transpile(await readFile('lib/ai/release-revision.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
const {validateRevision}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('revision validation preserves task identity and rejects incomplete, duplicate and invalid plans',()=>{
 const old={release:{title:'Daybreak',format:'Album',date:'2026-11-05',artist_id:randomUUID()},tasks:[{id:randomUUID(),title:'Artwork',due_date:'2026-10-15',version:1}]};
 const p={title:'Daybreak',format:'Album',date:'2026-11-12',question:'',tasks:old.tasks.map(t=>({id:t.id,title:t.title,due_date:t.due_date}))};
 assert.deepEqual(validateRevision(p,old),p);
 for(const tasks of [[],[...p.tasks,...p.tasks],[{...p.tasks[0],id:randomUUID()}],[{...p.tasks[0],due_date:'2026-02-30'}],[{...p.tasks[0],due_date:'2026-12-01'}]])assert.throws(()=>validateRevision({...p,tasks},old));
 assert.throws(()=>validateRevision({...p,date:'11/05'},old));
 assert.throws(()=>validateRevision({...p,title:''},old));
 assert.deepEqual(validateRevision({...p,tasks:[{...p.tasks[0],due_date:null}]},old).tasks[0].due_date,null);
});
test('fresh workspace: plan, brief, owner, Gmail approval, calendar lease, revised plan and protected send',async()=>{
 const db=new PGlite();try{
 const alice=randomUUID(),bob=randomUUID();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;insert into auth.users values('${alice}'),('${bob}');`);
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 const asUser=async(u)=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${u}',false);set role authenticated;`);
 await asUser(alice);
 assert.equal((await db.query('select * from workspaces')).rows.length,0);
 const w=(await db.query("select save_workspace_onboarding('Fresh manager','Artist Manager','','1–2','Fresh workspace',true) id")).rows[0].id;
 const r=(await db.query("select create_chat_release_plan($1,$2,null,'Daniel','Pop','Daybreak','2026-11-05',$3,'Album') id",[w,randomUUID(),JSON.stringify([{title:'Artwork',due_date:'2026-10-15'},{title:'Mastering',due_date:'2026-10-20'}])])).rows[0].id;
 const artist=(await db.query('select artist_id from releases where id=$1',[r])).rows[0].artist_id;
 await db.query("select save_artist_brief($1,$2,0,'Alex — mastering','Album campaign','Review every date change')",[w,artist]);
 const contact=(await db.query("insert into workspace_contacts(workspace_id,name,email,role) values($1,'Alex','alex@example.com','Engineer') returning id",[w])).rows[0].id;
 const task=(await db.query("select id from tasks where title='Mastering'")).rows[0].id;
 await db.query('select assign_task_owner($1,$2,1,$3)',[w,task,contact]);
 // Provider credentials and AI output are fixtures; this test sends no network requests.
 const conn=randomUUID();await db.query("insert into gmail_connections(workspace_id,user_id,connection_id,email,encrypted_refresh_token,can_send) values($1,$2,$3,'manager@example.com','encrypted-fixture-placeholder',true)",[w,alice,conn]);
 const evidence='Move Daniel Mastering to October 22, 2026.';
 const message=(await db.query("select import_gmail_message($1,$2,'fixture-mail','Alex','Mastering update',$3,now()) id",[w,conn,evidence])).rows[0].id;
 await db.query("select save_gmail_analysis($1,$2,0,$3,2,'2026-10-22',$4,'Matched named task')",[w,message,task,evidence]);
 assert.equal((await db.query('select due_date::text from tasks where id=$1',[task])).rows[0].due_date,'2026-10-20');
 const proposal=(await db.query('select id from deadline_proposals where message_id=$1',[message])).rows[0].id;
 await db.query('select decide_deadline_proposal($1,true)',[proposal]);
 assert.equal((await db.query('select due_date::text from tasks where id=$1',[task])).rows[0].due_date,'2026-10-22');
 const calendar=randomUUID();await db.query("insert into calendar_connections(workspace_id,user_id,connection_id,email,encrypted_refresh_token) values($1,$2,$3,'manager@example.com','fixture')",[w,alice,calendar]);
 assert.equal((await db.query('select claim_calendar_sync($1,$2,$3) ok',[w,calendar,randomUUID()])).rows[0].ok,true);
 assert.equal((await db.query('select claim_calendar_sync($1,$2,$3) ok',[w,calendar,randomUUID()])).rows[0].ok,false);
 const read=async()=>({release:(await db.query("select jsonb_build_object('title',title,'format',format,'date',release_date,'artist_id',artist_id) v from releases where id=$1",[r])).rows[0].v,tasks:(await db.query('select id,title,due_date::text,version from tasks where release_id=$1 order by id',[r])).rows});
 const original=await read();const updated=original.tasks.map(t=>({...t,due_date:'2026-10-29'}));
 const save=async(request,s=original,list=updated,date='2026-11-12',workspace=w)=>db.query("select revise_release_plan($1,$2,$3,$4,'Daybreak Deluxe','Album',$5,$6) id",[workspace,request,r,JSON.stringify(s.release),date,JSON.stringify(list)]);
 // A stale task must roll back all prior task updates in the same transaction.
 await assert.rejects(save(randomUUID(),original,updated.map((t,i)=>i===1?{...t,version:0}:t)));
 assert.deepEqual(await read(),original);
 await assert.rejects(save(randomUUID(),original,updated,'2026-10-01'));
 assert.deepEqual(await read(),original);
 await assert.rejects(save(randomUUID(),{...original,release:{...original.release,title:'Stale'}}));
 const request=randomUUID();await save(request);await save(request);
 assert.equal((await db.query('select owner_contact_id from tasks where id=$1',[task])).rows[0].owner_contact_id,contact);
 assert.deepEqual((await read()).tasks.map(t=>t.id),original.tasks.map(t=>t.id));
 assert.equal((await read()).release.title,'Daybreak Deluxe');
 assert.equal((await db.query('select count(*)::int n from tasks')).rows[0].n,2);
 await assert.rejects(save(randomUUID())); // Old snapshots cannot overwrite the revision.
 const current=await read();await db.query("update tasks set status='Complete' where id=$1",[task]);
 await assert.rejects(save(randomUUID(),current,current.tasks));
 await db.query("update tasks set status='Pending' where id=$1",[task]);
 const draft=randomUUID();await db.query("select save_task_email_draft($1,$2,$3,0,'alex@example.com','Mastering update','Reviewed update')",[w,draft,task]);
 const attempt=randomUUID();const claim=async(d=draft)=> (await db.query('select claim_task_email_send($1,$2,1,$3,$4) ok',[w,d,conn,attempt])).rows[0].ok;
 assert.equal(await claim(),true);await assert.rejects(db.query("select finish_task_email_send($1,$2,'fixture-provider-id')",[w,attempt]));await db.exec('reset role');await db.query("select record_google_send_result('task',$1,$2,$3,'fixture-provider-id','accepted')",[w,alice,attempt]);await asUser(alice);assert.equal(await claim(),false);
 const duplicate=randomUUID();await db.query("select save_task_email_draft($1,$2,$3,0,'alex@example.com','Mastering update','Reviewed update')",[w,duplicate,task]);assert.equal(await claim(duplicate),false);
 await assert.rejects(db.query("select save_task_email_draft($1,$2,$3,1,'alex@example.com','Mastering update','Changed')",[w,draft,task]));
 await asUser(bob);assert.equal((await db.query('select * from releases')).rows.length,0);assert.equal((await db.query('select * from artist_briefs')).rows.length,0);assert.equal((await db.query('select * from task_email_sends')).rows.length,0);await assert.rejects(save(request));
 const wb=(await db.query("select save_workspace_onboarding('Other','Artist Manager','','1–2','Other workspace',true) id")).rows[0].id;
 await assert.rejects(save(randomUUID(),current,current.tasks,'2026-11-12',wb));
 await db.exec('reset role;set role anon');await assert.rejects(save(request));
 }finally{await db.close();}
});
