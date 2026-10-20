import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function load(file,deps={}){const m={exports:{}};vm.runInNewContext(ts.transpile(readFileSync(file,'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),{module:m,exports:m.exports,process:{env:{}},require:n=>deps[n]});return m.exports;}
const analysis=load('lib/ai/email-analysis.ts');
const release=load('lib/ai/release-email.ts',{'./email-analysis':analysis});
const id='11111111-1111-4111-8111-111111111111';
const message={id,gmail_analysis_version:0,sender:'Sender',subject:'Deadline Adjustment for Daniel',body:`Hi Alex, I wanted to inform you that we need to move the deadline for Daniel's album, "Daybreak," to November 17th, 2026. Please let me know if you have any questions or need further details. Thanks, Srinithi`};
function fixture(data){const calls=[];const supabase={from(){const q={};q.select=q.eq=()=>q;q.single=async()=>({data:message});q.maybeSingle=async()=>({data:null});return q;},rpc:async(name,args)=>{calls.push({name,args});return {data:id,error:null};}};const actions=load('app/workspace/email-actions.ts',{'@/lib/ai/release-email':release,'@/lib/ai/email-analysis':analysis,'next/cache':{revalidatePath(){}},'@/lib/auth/session':{requireWorkspace:async()=>({workspace:{id:'workspace'}}),requireUser:async()=>({supabase})},'@/lib/workspace/data':{loadWorkspace:async()=>data},'@/lib/workspace/validation':{uuidPattern:/^[a-f0-9-]{36}$/}});return {run:()=>actions.analyzeGmailImport(id),calls};}
const base={artists:[],tasks:[],releases:[]};
test('analysis explains inaccessible artists and missing projects without calling AI',async()=>{
 for(const [data,expected] of [[base,/No artists are accessible/],[{...base,artists:[{record_id:'maya',name:'Maya'}]},/does not match an artist/],[{...base,artists:[{record_id:'daniel',name:'Daniel'}]},/no active project/]]){const f=fixture(data);assert.match((await f.run()).error,expected);assert.equal(f.calls.length,0);}
});
test('the reported email persists a release proposal using accessible saved IDs without AI credits',async()=>{
 const f=fixture({...base,artists:[{record_id:'daniel',name:'Daniel'}],releases:[{id:'release',artist_id:'daniel',title:'Daybreak',release_date:'2026-11-01',version:2}]});
 assert.equal((await f.run()).error,null);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'propose_email_release');assert.equal(f.calls[0].args.p_release,'release');assert.equal(f.calls[0].args.p_date,'2026-11-17');
});
