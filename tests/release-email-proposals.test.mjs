import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
test('email release approval is durable, idempotent, source-linked and access checked',async()=>{
 const db=new PGlite();try{
 await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;");
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 const owner=randomUUID(),manager=randomUUID(),other=randomUUID();
 await db.query('insert into auth.users values($1,$2),($3,$4),($5,$6)',[owner,'o@x.com',manager,'m@x.com',other,'x@x.com']);
 const as=async id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`);
 await as(owner);
 const w=(await db.query("select save_workspace_onboarding('Owner','Artist Manager','','1–2','Test',true) id")).rows[0].id;
 const a=(await db.query("insert into artists(workspace_id,name) values($1,'Daniel') returning record_id",[w])).rows[0].record_id;
 const r=(await db.query("insert into releases(workspace_id,artist_id,title,release_date,format) values($1,$2,'Daybreak','2026-11-17','Album') returning id",[w,a])).rows[0].id;
 await db.exec('reset role');
 await db.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'manager'),($1,$3,'manager')",[w,manager,other]);
 await as(owner);await db.query('select assign_artist_access($1,$2,$3,true)',[w,a,manager]);
 const body='Move Daniel’s Daybreak release from November 17, 2026 to November 24, 2026.';
 async function mail(date="2026-11-24"){
 await db.exec('reset role');const id=randomUUID();
 await db.query("insert into inbox_messages(id,workspace_id,source,sender,subject,body,fingerprint,analysis_status,analysis_note,imported_by) values($1::uuid,$2,'gmail','o@x.com','Release change',$3,$1::text,'needs_context','Imported',$4)",[id,w,date==='2026-11-24'?body:`Move Daniel’s Daybreak release to ${date}.`,manager]);
 await as(manager);return id;
 }
 const m=await mail();
 const propose=async(message,date='2026-11-24')=>{
 const v=(await db.query('select version from releases where id=$1',[r])).rows[0].version;
 return (await db.query('select propose_email_release($1,$2,$3,$4,$5,$6) id',[w,message,r,v,date,(await db.query('select body from inbox_messages where id=$1',[message])).rows[0].body])).rows[0].id;
 };
 const p=await propose(m);assert.equal(await propose(m),p);
 await as(other);assert.equal((await db.query('select * from release_email_proposals')).rows.length,0);
 await assert.rejects(db.query('select decide_email_release($1,$2,true)',[w,p]),/unavailable/);
 await assert.rejects(db.query('select propose_email_release($1,$2,$3,1,$4,$5)',[w,m,r,'2026-11-24',body]),/Access denied/);
 await as(manager);
 assert.equal((await db.query('select decide_email_release($1,$2,true) s',[w,p])).rows[0].s,'approved');
 const version=(await db.query('select version,release_date::text date from releases where id=$1',[r])).rows[0];
 assert.equal(version.date,'2026-11-24');
 await db.query('select decide_email_release($1,$2,true)',[w,p]);
 assert.equal((await db.query('select version from releases where id=$1',[r])).rows[0].version,version.version);
 assert.equal((await db.query('select status from release_email_proposals where id=$1',[p])).rows[0].status,'approved');
 const rejected=await propose(await mail('2026-12-01'),'2026-12-01');
 await db.query('select decide_email_release($1,$2,false)',[w,rejected]);
 assert.equal((await db.query('select decide_email_release($1,$2,true) s',[w,rejected])).rows[0].s,'rejected');
 const stale=await propose(await mail('2026-12-01'),'2026-12-01');
 await db.query("update releases set title='New title' where id=$1",[r]);
 assert.equal((await db.query('select decide_email_release($1,$2,true) s',[w,stale])).rows[0].s,'conflict');
 const blocked=await propose(await mail('2026-11-10'),'2026-11-10');
 await db.query("insert into tasks(workspace_id,artist_id,release_id,title,due_date) values($1,$2,$3,'Fixed deadline','2026-11-20')",[w,a,r]);
 assert.equal((await db.query('select decide_email_release($1,$2,true) s',[w,blocked])).rows[0].s,'conflict');
 await as(owner);
 assert.equal((await db.query("select count(*)::int n from workspace_activity where entity_id=$1 and action='approved'",[p])).rows[0].n,1);
 }finally{await db.close();}
});
