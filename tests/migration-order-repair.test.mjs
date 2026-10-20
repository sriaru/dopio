import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('025 after 026 is repaired without losing privacy or audit fixes; repair is repeatable',async()=>{
 const db=new PGlite();try{
 await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;");
 const files=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
 const read=n=>readFile('supabase/migrations/'+files.find(f=>f.includes(n)),'utf8');
 for(const f of files.filter(f=>!f.includes('025_')&&!f.includes('029_')))await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 await db.exec(await read('025_'));
 const repair=await read('029_');await db.exec(repair);await db.exec(repair);
 for(const name of ['approve_setup_document_v2','revise_release_plan']){
 const defs=(await db.query("select proname,prosrc,has_function_privilege('authenticated',oid,'execute') allowed from pg_proc where proname in ($1,$2)",[name,'private26_'+name])).rows;
 assert.match(defs.find(r=>r.proname===name).prosrc,/check_assigned_rpc/);
 assert.equal(defs.find(r=>r.proname===name).allowed,true);
 assert.equal(defs.find(r=>r.proname==='private26_'+name).allowed,false);
 }
 const revision=(await db.query("select prosrc from pg_proc where proname='private26_revise_release_plan'")).rows[0].prosrc;
 assert.match(revision,/t.archived_at is not null/);
 await db.exec('set role authenticated');
 await assert.rejects(db.query("select approve_setup_document_v2(gen_random_uuid(),gen_random_uuid(),'[]'::jsonb)"),/Access denied/);
 await assert.rejects(db.query("select revise_release_plan(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'{}','Hidden','Album','2027-01-01','[]')"),/Access denied/);
 }finally{await db.close();}
});
