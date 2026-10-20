import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
async function module(path){
 const dependency='data:text/javascript;base64,'+Buffer.from(ts.transpile(await readFile('lib/ai/email-analysis.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022})).toString('base64');
 const code=ts.transpile((await readFile(path,'utf8')).replace("'./email-analysis'",JSON.stringify(dependency)),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
 return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
const {documentRoster,restrictDocumentRoster,parseSetupTemplate}=await module('lib/ai/setup-document.ts');
const {reviewSetupResponse,validateSetup}=await module('lib/ai/setup-scan.ts');
test('document review keeps tour deadlines after its start and completed release work after launch',()=>{
 const notes='ARTIST\nArtist name: River\nGenre: Folk\nPROJECT\nProject title: Texas Tour\nType: Tour\nConfirmed release date: 2026-11-05\n- Task: Houston show\n  Confirmed deadline: 2026-11-12\n  Current status: Pending\nEND ARTIST';
 const proposal=parseSetupTemplate(notes,documentRoster(notes));
 assert.equal(proposal.artists[0].releases[0].tasks[0].due_date,'2026-11-12');
 assert.doesNotThrow(()=>validateSetup(proposal));
 const release=proposal.artists[0].releases[0];release.format='Album';
 assert.throws(()=>validateSetup(proposal),/Invalid task/);
 release.tasks[0].status='Complete';assert.doesNotThrow(()=>validateSetup(proposal));
});
test('document roster comes only from explicit artist headings or the manager override',async()=>{
 const text='Artist name: Luna Vale\nGenre: Indie pop\nMy kid Alex has a school play. Contact: Chris\nArtist name: Maya Chen\nArtist name: luna vale';
 assert.deepEqual(documentRoster(text),['luna vale','Maya Chen']);
 assert.deepEqual(documentRoster(text,'Jaxon\nMaya Chen'),['Jaxon','Maya Chen']);
 assert.throws(()=>documentRoster('My kid Alex sings and Chris is an engineer.'));
 assert.throws(()=>documentRoster('Artist name:\nGenre: pop'),'blank heading must not consume the next line');
 assert.throws(()=>documentRoster(awaitableTemplate));
});
const awaitableTemplate=await readFile('public/templates/dopio-artist-brief.txt','utf8');
test('out-of-roster names and existing artists are removed even when AI proposes them with real quotes',()=>{
 const proposal={artists:[{name:'Luna Vale'},{name:'Alex'},{name:'Chris'},{name:'Maya Chen'}],questions:''};
 const result=restrictDocumentRoster(proposal,['Luna Vale','Maya Chen','Jaxon'],[{name:'Maya Chen'}]);
 assert.deepEqual(result.artists.map(a=>a.name),['Luna Vale']);
 assert.match(result.questions,/Jaxon/);
});
test('document review preserves multiple releases with undated work',()=>{
 const source={id:'document',label:'Brief',text:'Artist name: Luna Vale\nProject title: Slow Motion\nTask: Cover art\nProject title: After Hours\nTask: Mastering'};
 const release=(title,task)=>({title,format:'Single',date:'',source_id:'document',evidence:'Project title: '+title,tasks:[{title:task,due_date:'',source_id:'document',evidence:'Task: '+task}]});
 const response={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({artists:[{name:'Luna Vale',genre:'',context:'',source_id:'document',evidence:'Artist name: Luna Vale',releases:[release('Slow Motion','Cover art'),release('After Hours','Mastering')]}],questions:''})}]}]};
 const p=reviewSetupResponse(response,[source]);
 assert.deepEqual(p.artists[0].releases.map(r=>r.title),['Slow Motion','After Hours']);
 assert.equal(p.artists[0].releases[1].tasks[0].due_date,'');
});
test('document approval saves all chosen releases once, rolls back invalid batches, and checks membership',async()=>{
 const db=new PGlite();
 try{
  const user=randomUUID(),other=randomUUID();
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;insert into auth.users values('${user}'),('${other}');`);
  for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
  await db.exec(`select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`);
  const workspace=(await db.query("select save_workspace_onboarding('Manager','Artist Manager','','1–2','Workspace',true) id")).rows[0].id;
  const release=title=>({title,format:'Single',date:'',source_id:'document',evidence:'Project title: '+title,tasks:[{title:'Cover art',due_date:'',source_id:'document',evidence:'Task: Cover art'}]});
  const artist={name:'Luna Vale',genre:'Pop',context:'Check before spending.',source_id:'document',evidence:'Artist name: Luna Vale',releases:[release('Slow Motion'),release('After Hours')]};
  const approve=(id,artists)=>db.query('select approve_setup_document($1,$2,$3) ids',[workspace,id,JSON.stringify(artists)]);
  const id=randomUUID();const first=await approve(id,[artist]);const retry=await approve(id,[artist]);assert.deepEqual(first.rows,retry.rows);
  assert.equal((await db.query('select * from artists')).rows.length,1);
  assert.equal((await db.query('select * from releases')).rows.length,2);
  assert.equal((await db.query('select * from tasks')).rows.length,2);
  assert.equal((await db.query('select due_date from tasks')).rows[0].due_date,null);
  await assert.rejects(approve(randomUUID(),[{...artist,name:'Maya Chen',releases:[release('Good'),{...release('Invalid'),format:''}]}]));
  assert.equal((await db.query('select * from artists')).rows.length,1);
  assert.equal((await db.query('select * from releases')).rows.length,2);
  await approve(randomUUID(),[{...artist,name:'Jaxon',releases:[]}]);
  assert.equal((await db.query('select * from releases')).rows.length,2,'artist-only approval adds no releases');
  await db.exec(`reset role;select set_config('request.jwt.claim.sub','${other}',false);set role authenticated;`);
  await assert.rejects(approve(id,[artist]));
  await db.exec('reset role;set role anon');await assert.rejects(approve(id,[artist]));
 }finally{await db.close();}
});
test('numbered artist brief headings recognize the three roster artists without collecting contacts',()=>{
 const brief=`Artist Management Brief
Management Company: Northline Management Manager: Alex Morgan
Date: October 8, 2026 Artists: 3
Artist 1: Maya Bennett (MAYA)
Genre: Indie Pop / Alternative R&B Location: Los Angeles, CA
Current Project: After Hours EP
Team & Contacts
• Jordan Lee — Producer — jordan@example.com
• Sophie Chen — Graphic Designer — sophie@example.com
• Daniel Brooks — PR Consultant — daniel@example.com
Artist 2: River James (RIVER)
Current Project: Texas Fall Tour
Team & Contacts
• Chris Walker — Booking Agent — chris@example.com
• Emma Davis — Tour Coordinator — emma@example.com
• Taylor Reed — Photographer — taylor@example.com
Artist 3: Noah Carter (NOAH C)
Current Project: No Signal Single
Team & Contacts
• Marcus Hill — Producer — marcus@example.com
• Olivia Park — Video Director — olivia@example.com
• Rachel Kim — Brand Partnerships — rachel@example.com
Management-Wide Priorities
• Keep all three artists’ projects on schedule.`;
 const roster=documentRoster(brief);
 assert.deepEqual(roster,['Maya Bennett (MAYA)','River James (RIVER)','Noah Carter (NOAH C)']);
 const result=restrictDocumentRoster({artists:[{name:'Maya Bennett'},{name:'RIVER'},{name:'Noah Carter (NOAH C)'},{name:'Chris Walker'},{name:'Alex Morgan'}],questions:''},roster,[]);
 assert.deepEqual(result.artists.map(a=>a.name),roster);
 assert.equal(result.questions,'');
});
test('common heading styles work but counts, blank headings and prose do not become names',()=>{
 assert.deepEqual(documentRoster('## Artist 1: Maya Bennett (MAYA)\n**Artist name:** River James\n- Artist: Noah Carter'),['Maya Bennett (MAYA)','River James','Noah Carter']);
 for(const text of ['Artists: 3','Artist 1:\nGenre: Pop','We discussed Artist 1: Alex at school.','Artist Management Brief\nManager: Alex'])assert.throws(()=>documentRoster(text));
});
test('aliases cannot create duplicate existing artists or resolve ambiguous identities',()=>{
 const roster=['Maya Bennett (MAYA)','River James (RIVER)'];
 assert.deepEqual(restrictDocumentRoster({artists:[{name:'MAYA'},{name:'Maya Bennett'},{name:'RIVER'}],questions:''},roster,[{name:'Maya Bennett'}]).artists.map(a=>a.name),['River James (RIVER)']);
 const ambiguous=restrictDocumentRoster({artists:[{name:'MAYA'}],questions:''},['Maya Bennett (MAYA)','Maya Jones (MAYA)'],[]);
 assert.equal(ambiguous.artists.length,0);
});

test('the uploaded three-artist template produces a grounded review directly, with no invented confirmed dates',async()=>{
 const text=await readFile('tests/fixtures/manager-onboarding.txt','utf8');
 const roster=documentRoster(text);
 const parsed=parseSetupTemplate(text,roster);
 assert.ok(parsed);
 const result=restrictDocumentRoster(validateSetup(parsed,[{id:'document',label:'Brief',text}],true),roster,[]);
 assert.deepEqual(result.artists.map(a=>a.name),['MAYA (Maya Bennett)','RIVER (River James)','NOAH C (Noah Carter)']);
 assert.deepEqual(result.artists.map(a=>a.releases.length),[1,1,1]);
 assert.equal(result.artists[0].releases[0].title,'After Hours EP');
 assert.equal(result.artists[2].releases[0].format,'Single');
 assert.equal(result.artists[0].releases[0].tasks.length,7);
 assert.equal(result.artists[2].releases[0].tasks.length,7);
 assert.ok(result.artists.flatMap(a=>a.releases).every(r=>r.date===''&&r.tasks.every(t=>t.due_date==='')));
 assert.match(result.artists[1].context,/Texas Fall Tour/);
 assert.match(result.artists[0].releases[0].tasks[0].evidence,/Target 2026-10-14/);
 assert.match(result.questions,/unconfirmed/);
});
test('template parser keeps confirmed dates and does not consume the following label for blank dates',()=>{
 const text='ARTIST\nArtist name: Luna\nGenre: Pop\nPROJECT\nProject title: Moon\nType: Single\nConfirmed release date: 2026-12-01\n- Task: Artwork\n  Confirmed deadline:\n  Unconfirmed deadline wording: Target 2026-11-20\nEND ARTIST';
 const parsed=parseSetupTemplate(text,documentRoster(text));
 assert.equal(parsed.artists[0].releases[0].date,'2026-12-01');
 assert.equal(parsed.artists[0].releases[0].tasks[0].due_date,'');
 assert.equal(parseSetupTemplate('Artist 1: Luna\nOther details.', ['Luna']),null);
});
