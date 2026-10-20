import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const dependency='data:text/javascript;base64,'+Buffer.from(ts.transpile(await readFile('lib/ai/email-analysis.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022})).toString('base64');
const source=ts.transpile((await readFile('lib/ai/setup-scan.ts','utf8')).replace("'./email-analysis'",JSON.stringify(dependency)),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
const {validateSetup,reviewSetupResponse}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const artist={name:'Daniel',genre:'Pop',context:'Preparing an album.',source_id:'document',evidence:'I manage Daniel, a pop artist.'};
test('setup scans require a real source quote containing the artist and reject duplicate suggestions',()=>{
 const sources=[{id:'document',label:'Brief',text:artist.evidence}];const p={artists:[artist],questions:''};assert.deepEqual(validateSetup(p,sources),p);
 for(const a of [{...artist,evidence:'Invented evidence'},{...artist,source_id:'unknown'},{...artist,name:'Maya'}])assert.throws(()=>validateSetup({artists:[a],questions:''},sources));
 assert.throws(()=>validateSetup({artists:[artist,artist],questions:''},sources));
 assert.deepEqual(validateSetup({artists:[],questions:'Which artists do you manage?'},sources).artists,[]);
});
test('release suggestions require real dates and evidence for each task',()=>{
 const release={title:'Daybreak',format:'Album',date:'2026-11-12',source_id:'document',evidence:'Daniel releases Daybreak on November 12, 2026.',tasks:[{title:'Artwork',due_date:'2026-10-20',source_id:'document',evidence:'Artwork is due October 20, 2026.'}]};
 const sources=[{id:'document',label:'Brief',text:artist.evidence+' '+release.evidence+' '+release.tasks[0].evidence}];
 const p={artists:[{...artist,release}],questions:''};assert.equal(validateSetup(p,sources).artists[0].release.tasks.length,1);
 for(const r of [{...release,date:'11/12'},{...release,tasks:[{...release.tasks[0],due_date:'2026-12-01'}]},{...release,tasks:[{...release.tasks[0],evidence:'invented'}]}])assert.throws(()=>validateSetup({artists:[{...artist,release:r}],questions:''},sources));
});
test('setup approval creates multiple artists without tasks, is atomic and repeat safe, and isolates workspaces',async()=>{
 const db=new PGlite();try{
 const user=randomUUID(),other=randomUUID();await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;insert into auth.users values('${user}'),('${other}');`);
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 await db.exec(`select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`);
 const w=(await db.query("select save_workspace_onboarding('Manager','Artist Manager','','1–2','Workspace',true) id")).rows[0].id;
 const approve=async(request,artists)=>(await db.query('select approve_setup_artists($1,$2,$3) ids',[w,request,JSON.stringify(artists)])).rows[0].ids;
 const request=randomUUID();const items=[artist,{...artist,name:'Maya',evidence:'I also manage Maya.'}];const ids=await approve(request,items);assert.equal(ids.length,2);assert.deepEqual(await approve(request,items),ids);
 assert.equal((await db.query('select count(*)::int n from artists')).rows[0].n,2);assert.equal((await db.query('select count(*)::int n from tasks')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from artist_briefs')).rows[0].n,2);assert.match((await db.query('select release_context from artist_briefs where artist_id=$1',[ids[0]])).rows[0].release_context,/Source quote:/);
 await assert.rejects(approve(randomUUID(),[{...artist,name:'Aaron'},artist]));assert.equal((await db.query('select count(*)::int n from artists')).rows[0].n,2,'first insert rolls back when second name conflicts');
 await assert.rejects(approve(randomUUID(),[{...artist,name:'River',genre:null}]));await assert.rejects(approve(randomUUID(),[]));
 const release={title:'Sunrise',format:'Album',date:'2026-12-10',source_id:'document',evidence:'Sunrise is an album releasing December 10, 2026.',tasks:[{title:'Mastering',due_date:'2026-11-20',source_id:'document',evidence:'Mastering is due November 20, 2026.'}]};
 await assert.rejects(approve(randomUUID(),[{...artist,name:'River',release:{...release,tasks:[{...release.tasks[0],due_date:'2027-01-01'}]}}]));
 assert.equal((await db.query('select count(*)::int n from artists')).rows[0].n,2);
 await approve(randomUUID(),[{...artist,name:'Undated',release:{...release,date:'',tasks:[{...release.tasks[0],due_date:''}]}}]);
 assert.equal((await db.query('select due_date from tasks')).rows[0].due_date,null);
 const releaseRequest=randomUUID();await approve(releaseRequest,[{...artist,name:'River',release}]);await approve(releaseRequest,[{...artist,name:'River',release}]);
 assert.equal((await db.query('select count(*)::int n from releases')).rows[0].n,2);assert.equal((await db.query('select count(*)::int n from tasks')).rows[0].n,2);
 assert.match((await db.query('select notes from tasks')).rows[0].notes,/Mastering is due/);
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','${other}',false);set role authenticated;`);await assert.rejects(approve(request,items));assert.equal((await db.query('select * from artists')).rows.length,0);
 await db.exec('reset role;set role anon');await assert.rejects(approve(request,items));
 }finally{await db.close();}
});

const responseFor=p=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(p)}]}]});
test('scan review keeps grounded artists when optional releases or other artists fail',()=>{
 const sources=[{id:'document',label:'Brief',text:artist.evidence}];
 const result=reviewSetupResponse(responseFor({artists:[{...artist,release:{title:'Daybreak',format:'album',date:'11/05',tasks:[]}},{...artist,name:'Invented',evidence:'Not in source'}],questions:''}),sources);
 assert.equal(result.artists.length,1);assert.equal(result.artists[0].name,'Daniel');assert.equal(result.artists[0].release,null);assert.match(result.questions,/release was excluded/);assert.match(result.questions,/artist suggestion was excluded/);
});
test('scan review removes unsupported tasks without dropping the artist or valid release',()=>{
 const release={title:'Daybreak',format:'Album',date:'2026-11-12',source_id:'document',evidence:'Daniel releases Daybreak on November 12, 2026.',tasks:[{title:'Artwork',due_date:'2026-10-20',source_id:'document',evidence:'Artwork is due October 20, 2026.'},{title:'Invented',due_date:'2026-10-01',source_id:'document',evidence:'not in source'}]};
 const sources=[{id:'document',label:'Brief',text:[artist.evidence,release.evidence,release.tasks[0].evidence].join(' ')}];
 const result=reviewSetupResponse(responseFor({artists:[{...artist,release}],questions:''}),sources);
 assert.equal(result.artists[0].release.tasks.length,1);assert.match(result.questions,/task was excluded/);
});
test('scan distinguishes refusal, incomplete output and unreadable results',()=>{
 assert.throws(()=>reviewSetupResponse({status:'incomplete',output:[]},[]),/incomplete/);
 assert.throws(()=>reviewSetupResponse({status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]},[]),/refusal/);
 assert.throws(()=>reviewSetupResponse({status:'completed',output:[]},[]),/response_format/);
 const result=reviewSetupResponse(responseFor({artists:[artist],questions:''}),[]);assert.equal(result.artists.length,0);assert.match(result.questions,/excluded/);
});

test('Luna note can propose an artist while an incomplete release and unrelated bad email suggestion are excluded',()=>{
 const text=`Luna Vale is a 21-year-old indie pop artist based in Austin. She has around 45K monthly Spotify listeners and has recently started growing on TikTok from clips of her unreleased music.

Her next single, “Slow Motion,” is planned for November 13. Final master is done, but we still need cover art, final credits, and distribution submitted. She wants to announce the song about two weeks before release and post 3–4 short-form videos leading up to it.

She’s also looking to start playing more live shows in Austin, Dallas, and Houston. Ideally 200–500 cap venues or opening slots for similar indie/pop artists. She’s available most weekends except November 7–8.

Current priorities are getting “Slow Motion” released on time, finding show opportunities, growing TikTok/Instagram, and reaching out to smaller music blogs and playlists around the release.

Luna handles most creative decisions herself. Please check with me before confirming any shows, spending money, agreeing to brand deals, or changing release dates.`;
 const luna={name:'Luna Vale',genre:'Indie pop',context:'Based in Austin. Ask the manager before confirming shows, spending money, agreeing to brand deals, or changing release dates.',source_id:'document',evidence:'Luna Vale is a 21-year-old indie pop artist based in Austin.',release:{title:'Slow Motion',format:'Single',date:'November 13',tasks:[],source_id:'document',evidence:'Her next single, “Slow Motion,” is planned for November 13.'}};
 const result=reviewSetupResponse(responseFor({artists:[luna,{...artist,source_id:'gmail:missing'}],questions:'What year is the November 13 release?'}),[{id:'document',label:'Notes',text}]);
 assert.equal(result.artists.length,1);assert.equal(result.artists[0].name,'Luna Vale');assert.equal(result.artists[0].release.title,'Slow Motion');assert.equal(result.artists[0].release.date,'');assert.match(result.questions,/What year/);
});

test('Jaxon and Maya remain reviewable with unknown formats, years and relative deadlines',()=>{
 const sources=[
 {id:'jaxon',label:'Session',text:'Just checking on the November 3 session for Jaxon.'},
 {id:'track',label:'Feature',text:'Following up on Jaxon’s track “2AM” with Eli. We still need to get the feature paperwork finalized before you guys distribute the track.'},
 {id:'maya',label:'Release',text:'We’re still missing a few items for Maya Chen’s upcoming release “Backseat,” currently scheduled for October 30. Final 3000x3000 artwork. Please send these by 5 PM tomorrow.'}
 ];
 const p=reviewSetupResponse(responseFor({questions:'Confirm dates and release formats.',artists:[
 {name:'Jaxon',genre:'',context:'Session November 3; track 2AM with Eli.',source_id:'jaxon',evidence:sources[0].text,release:{title:'2AM',format:'',date:'',source_id:'track',evidence:'Following up on Jaxon’s track “2AM” with Eli.',tasks:[]}},
 {name:'Maya Chen',genre:'',context:'Backseat scheduled October 30; year unconfirmed.',source_id:'maya',evidence:sources[2].text,release:{title:'Backseat',format:'',date:'October 30',source_id:'maya',evidence:sources[2].text,tasks:[{title:'Deliver final artwork',due_date:'tomorrow',source_id:'maya',evidence:'Final 3000x3000 artwork.'}]}}
 ]}),sources);
 assert.deepEqual(p.artists.map(a=>a.name),['Jaxon','Maya Chen']);
 assert.equal(p.artists[1].release.title,'Backseat');
 assert.equal(p.artists[1].release.date,'');
 assert.equal(p.artists[1].release.tasks[0].due_date,'');
 assert.throws(()=>validateSetup(p),'saving a release still requires the manager to confirm its format');
 p.artists.forEach(a=>a.release.format='Single');assert.doesNotThrow(()=>validateSetup(p));
});
test('typographic quote differences preserve original evidence without accepting invented quotes',()=>{
 const sources=[{id:'document',label:'Brief',text:'Daniel’s next release is coming.\nDaniel is an artist.'}];
 const p=reviewSetupResponse(responseFor({artists:[{...artist,evidence:"Daniel's next release is coming."}],questions:''}),sources);
 assert.equal(p.artists[0].evidence,'Daniel’s next release is coming.');
});

test('custom brief extraction cannot turn a target or contradictory date into a confirmed deadline',()=>{
 const text='I manage Daniel, a pop artist. Daybreak target release: 2026-11-05. Artwork target: 2026-10-15.';
 const release={title:'Daybreak',format:'Album',date:'2026-11-05',source_id:'document',evidence:'Daybreak target release: 2026-11-05.',tasks:[{title:'Artwork',due_date:'2026-10-15',source_id:'document',evidence:'Artwork target: 2026-10-15.'}]};
 const response=()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({artists:[{...artist,releases:[release]}],questions:''})}]}]});
 const sources=[{id:'document',label:'Brief',text}];
 const p=reviewSetupResponse(response(),sources);
 assert.equal(p.artists[0].releases[0].date,'');assert.equal(p.artists[0].releases[0].tasks[0].due_date,'');
 release.date='2029-11-05';assert.equal(reviewSetupResponse(response(),sources).artists[0].releases[0].date,'');
});
