import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;`);
 const owner=randomUUID(),member=randomUUID();
 for(const [id,email] of [[owner,'owner@example.com'],[member,'member@example.com']])await db.query('insert into auth.users values($1,$2)',[id,email]);
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 const as=async id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`);
 await as(owner);
 const w=(await db.query("select save_workspace_onboarding('Owner','Artist Manager','','3–5','Audit',true) id")).rows[0].id;
 const artist=(await db.query("insert into artists(workspace_id,name) values($1,'Audit Artist') returning record_id",[w])).rows[0].record_id;
 return {db,owner,member,as,w,artist};
}

test('members can edit work but cannot archive it through the RPC',async()=>{
 const {db,owner,member,as,w,artist}=await fixture();try{
 const token='c'.repeat(64);
 await db.query("select create_workspace_invite($1,'member@example.com','member',$2)",[w,token]);
 await as(member);await db.query('select accept_workspace_invite($1)',[token]);
 await as(owner);await db.query('select assign_artist_access($1,$2,$3,true)',[w,artist,member]);await as(member);
 await db.query("update artists set genre='Pop' where record_id=$1",[artist]);
 const version=(await db.query('select version from artists where record_id=$1',[artist])).rows[0].version;
 await assert.rejects(db.query("select archive_workspace_record($1,'artist',$2,$3,true)",[w,artist,version]),/owner or manager/);
 await as(owner);await db.query("select archive_workspace_record($1,'artist',$2,$3,true)",[w,artist,version]);
 assert.ok((await db.query('select archived_at from artists where record_id=$1',[artist])).rows[0].archived_at);
 }finally{await db.close();}
});

test('a tour can have tasks after its project date, while a music release keeps deadline validation',async()=>{
 const {db,w,artist}=await fixture();try{
 const tour=(await db.query("insert into releases(workspace_id,artist_id,title,format,release_date) values($1,$2,'Texas Tour','Tour','2026-11-05') returning id",[w,artist])).rows[0].id;
 await db.query("insert into tasks(workspace_id,artist_id,release_id,title,due_date) values($1,$2,$3,'Houston show','2026-11-12')",[w,artist,tour]);
 await assert.rejects(db.query("update releases set format='EP' where id=$1",[tour]),/after the release date/);
 const payload=[{name:'Tour Artist',genre:'Folk',context:'Tour',source_id:'document',evidence:'Tour Artist',contacts:[],releases:[{title:'Fall Tour',format:'Tour',date:'2026-11-05',source_id:'document',evidence:'Fall Tour',tasks:[{title:'Houston show',due_date:'2026-11-12',source_id:'document',evidence:'Houston show'}]}]}];
 await db.query('select approve_setup_document_v2($1,$2,$3)',[w,randomUUID(),JSON.stringify(payload)]);
 assert.equal((await db.query("select count(*)::int n from tasks where title='Houston show'")).rows[0].n,2);
 }finally{await db.close();}
});

test('release revisions ignore archived tasks and reject attempts to edit them',async()=>{
 const {db,w,artist}=await fixture();try{
 const release=(await db.query("insert into releases(workspace_id,artist_id,title,format,release_date) values($1,$2,'Album','Album','2026-12-01') returning id",[w,artist])).rows[0].id;
 const task=(await db.query("insert into tasks(workspace_id,artist_id,release_id,title,due_date) values($1,$2,$3,'Cancelled work','2026-11-20') returning id,version",[w,artist,release])).rows[0];
 await db.query("select archive_workspace_record($1,'task',$2,$3,true)",[w,task.id,task.version]);
 const expected={title:'Album',format:'Album',date:'2026-12-01',artist_id:artist};
 await db.query("select revise_release_plan($1,$2,$3,$4,'Album','Album','2026-11-01','[]')",[w,randomUUID(),release,JSON.stringify(expected)]);
 const archived=(await db.query('select * from tasks where id=$1',[task.id])).rows[0];
 await assert.rejects(db.query("select revise_release_plan($1,$2,$3,$4,'Album','Album','2026-11-01',$5)",[w,randomUUID(),release,JSON.stringify({...expected,date:'2026-11-01'}),JSON.stringify([{id:task.id,version:archived.version,title:'Changed archived task',due_date:null}])]),/Task unavailable/);
 assert.equal(archived.title,'Cancelled work');
 }finally{await db.close();}
});
