import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('timezone migration defaults existing/new workspaces to Central, validates zones and preserves dates',async()=>{
 const db=new PGlite();try{
 await db.exec("create role anon;create role authenticated;create table public.workspaces(id int primary key);insert into public.workspaces values(1);create table public.tasks(id int,due_date date,owner_contact_id int);insert into public.tasks values(1,'2026-10-14',42);");
 await db.exec(await readFile('supabase/migrations/202610140033_workspace_timezone.sql','utf8'));
 await db.exec('insert into public.workspaces(id) values(2)');
 assert.deepEqual((await db.query('select time_zone from workspaces order by id')).rows.map(r=>r.time_zone),['America/Chicago','America/Chicago']);
 await assert.rejects(db.exec("update workspaces set time_zone='not-a-zone' where id=1"),/Invalid workspace timezone/);
 await db.exec("update workspaces set time_zone='America/New_York' where id=2");
 assert.deepEqual((await db.query('select due_date::text,owner_contact_id from tasks')).rows,[{due_date:'2026-10-14',owner_contact_id:42}]);
 }finally{await db.close();}
});
