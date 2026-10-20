import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const source=ts.transpile(await readFile('lib/calendar/events.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
const {matchesCalendarMarker,eventId,eventBody,upsertEvent,snapshot,removeManagedEvent,projectCalendarItems}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('confirmed task deadlines sync without a project date and tours are not labeled releases',()=>{
 const project={id:'tour',title:'Texas Tour',format:'Tour',release_date:null};
 const tasks=[{id:'one',title:'Book Houston',due_date:'2026-11-12'},{id:'two',title:'Book Dallas',due_date:null}];
 const preview=projectCalendarItems('workspace','River',project,tasks);
 assert.equal(preview.items.length,1);assert.equal(preview.undated,1);
 assert.equal(preview.items[0].date,'2026-11-12');assert.equal(preview.items[0].id,eventId('workspace','task','one'));
 const dated=projectCalendarItems('workspace','River',{...project,release_date:'2026-11-05'},tasks);
 assert.equal(dated.items[0].summary,'River — Texas Tour');
 assert.equal(dated.items[1].id,preview.items[0].id);
 assert.equal(projectCalendarItems('workspace','River',project,[]).items.length,0);
});
const item={id:eventId('workspace','task','task-id'),summary:'Daniel — Artwork',date:'2026-12-31',description:'Daybreak'};
test('stable event identity and timezone independent all-day dates',()=>{
 assert.match(item.id,/^[a-f0-9]{64}$/);assert.equal(eventId('workspace','task','task-id'),item.id);
 assert.notEqual(eventId('other','task','task-id'),item.id);assert.notEqual(eventId('workspace','release','task-id'),item.id);
 const body=eventBody(item);assert.equal(body.end.date,'2027-01-01');assert.deepEqual(body.reminders,{useDefault:false});assert.equal(body.attendees,undefined);
 assert.throws(()=>eventBody({...item,date:'2026-02-30'}));assert.notEqual(snapshot([item]),snapshot([{...item,date:'2026-12-30'}]));
});
test('event retries recover insert conflicts without duplicate IDs and use etags',async()=>{
 const requests=[];let calls=0;
 const old={...eventBody(item),summary:'Old title',etag:'version-1'};
 const mock=async(url,init)=>{
  requests.push({url,...init});calls++;
  if(calls===1)return new Response('',{status:404});
  if(calls===2)return new Response('',{status:409});
  if(calls===3)return Response.json(old);
  assert.equal(init.headers['If-Match'],'version-1');return Response.json({id:item.id,...eventBody(item)});
 };
 assert.equal(await upsertEvent('secret','calendar@example.com',item,mock),'updated');
 assert.equal(requests.filter(r=>r.method==='POST').length,1);
 assert.equal(JSON.parse(requests[1].body).id,item.id);
 assert.match(requests[1].url,/sendUpdates=none/);
 assert.equal(await upsertEvent('secret','cal',item,async()=>Response.json({...eventBody(item),etag:'v'})),'unchanged');
 let restored=false;assert.equal(await upsertEvent('secret','cal',item,async(url,init)=>{if(init.method==='PATCH'){restored=true;assert.equal(JSON.parse(init.body).status,'confirmed');assert.equal(init.headers['If-Match'],'version-1');return Response.json({id:item.id,...eventBody(item)});}return Response.json({...old,status:'cancelled'});}),'updated');assert.equal(restored,true);
 await removeManagedEvent('secret','cal',{...item,etag:'v'},async(url,init)=>{assert.equal(init.method,'DELETE');assert.equal(init.headers['If-Match'],'v');return new Response(null,{status:204});});
 await assert.rejects(removeManagedEvent('secret','cal',{...item,etag:'v'},async()=>new Response(null,{status:412})),/changed in Google/);
 let n=0;await assert.rejects(upsertEvent('secret','cal',item,async()=>++n===1?Response.json(old):new Response('private payload',{status:412})),/changed in Google/);
});
test('Calendar credentials are member private and sync leases serialize approvals',async()=>{
 const db=new PGlite();try{
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333',lease='44444444-4444-4444-8444-444444444444';
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;insert into auth.users values('${a}'),('${b}');`);
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 const user=async(id)=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`);
 await user(a);const w=(await db.query("select save_workspace_onboarding('Alice','Artist Manager','','1–2','Workspace',true) id")).rows[0].id;
 await db.query("insert into calendar_connections(workspace_id,user_id,connection_id,email,encrypted_refresh_token) values($1,$2,$3,'a@example.com','ciphertext')",[w,a,c]);
 const claim=async()=>(await db.query('select claim_calendar_sync($1,$2,$3) ok',[w,c,lease])).rows[0].ok;
 assert.equal(await claim(),true);assert.equal(await claim(),false);
 await db.exec('reset role');await db.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'member')",[w,b]);
 await user(b);assert.equal((await db.query('select * from calendar_connections')).rows.length,0);assert.equal(await claim(),false);
 await assert.rejects(db.query("insert into calendar_connections(workspace_id,user_id,connection_id,email) values($1,$2,$3,'a@example.com')",[w,a,c]));
 await user(a);await db.query('update calendar_connections set lease_until=now()-interval \'1 minute\' where workspace_id=$1',[w]);assert.equal(await claim(),true);
 await db.query('update calendar_connections set encrypted_refresh_token=null,lease_until=null where workspace_id=$1',[w]);assert.equal(await claim(),false);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from calendar_connections'));await assert.rejects(claim());
 }finally{await db.close();}
});

test('calendar recovery recognizes both brands only for the same workspace and member',()=>{
 for(const brand of ['AURA','Dopio']){
 assert.equal(matchesCalendarMarker(`${brand} workspace w; member u`,'w','u'),true);
 assert.equal(matchesCalendarMarker(`${brand} workspace w; member u`,'other','u'),false);
 assert.equal(matchesCalendarMarker(`${brand} workspace w; member u`,'w','other'),false);
 }
 assert.equal(matchesCalendarMarker(undefined,'w','u'),false);
});

test('Google edits since preview are rejected before mutation, including concurrent inserts',async()=>{
 let writes=0;
 const mock=async(url,init)=>{if(init.method!=='GET')writes++;return Response.json({...eventBody(item),etag:'new'});};
 await assert.rejects(upsertEvent('token','calendar',item,mock,'old'),/changed in Google/);
 await assert.rejects(upsertEvent('token','calendar',item,mock,null),/changed in Google/);
 assert.equal(writes,0);
 let n=0;
 await assert.rejects(upsertEvent('token','calendar',item,async()=>{
 n++;return n===1?new Response('',{status:404}):n===2?new Response('',{status:409}):Response.json({...eventBody(item),etag:'other'});
 },null),/changed in Google/);
 assert.equal(n,3);
});

test('an incomplete Google write response is not reported as confirmed',async()=>{
 let n=0;await assert.rejects(upsertEvent('token','cal',item,async()=>++n===1?new Response('',{status:404}):Response.json({})),/did not confirm/);
 assert.equal(n,2);
});
