import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const contextCode=ts.transpile(await readFile('lib/ai/assistant-context.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
const context=await import('data:text/javascript;base64,'+Buffer.from(contextCode).toString('base64'));
const toolsCode=ts.transpile(await readFile('lib/ai/assistant-tools.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
const tools=await import('data:text/javascript;base64,'+Buffer.from(toolsCode).toString('base64'));
const rulesCode=ts.transpile(await readFile('lib/workspace/rules.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
const rules=await import('data:text/javascript;base64,'+Buffer.from(rulesCode).toString('base64'));
const source=ts.transpile(await readFile('app/workspace/assistant-actions.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
function fixture(reply){
 const calls=[];let input;let ai=0;
 const supabase={rpc:async(name)=>({data:name==='workspace_sender_name'?'Alex Morgan':name==='task_managers'?[]:true,error:null}),from(table){const q={};for(const method of ['select','eq','is','limit','order','range','neq'])q[method]=(...args)=>{calls.push([table,method,...args]);return q;};q.single=async()=>({data:{time_zone:'America/Chicago'},error:null});q.then=resolve=>Promise.resolve({data:table==='artists'?[{record_id:'allowed-id',name:'Daniel'}]:[],error:null}).then(resolve);return q;}};
 const mod={exports:{}};vm.runInNewContext(source,{module:mod,exports:mod.exports,process:{env:{OPENAI_API_KEY:'test'}},AbortSignal,Date,require(name){if(name==='node:crypto')return {randomUUID:()=>crypto.randomUUID()};if(name.includes('assistant-context'))return context;if(name.includes('assistant-tools'))return tools;if(name.includes('rules'))return rules;if(name.includes('/gmail/actions'))return {};if(name.includes('/calendar/actions'))return {};if(name.includes('session'))return {requireWorkspace:async()=>({workspace:{id:'active-workspace'},user:{id:'current-user'}}),requireUser:async()=>({supabase})};if(name.includes('chat-text'))return {cleanChatText:t=>t.trim()};if(name.includes('signature'))return {signMessage:(b,n)=>b+'\nThanks,\n'+n};return {planSchema:{type:'object'},validatePlan:v=>v};},fetch:async(url,options)=>{ai++;input=JSON.parse(JSON.parse(options.body).input);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(reply)}]}]})};}});
 return {ask:mod.exports.askDopio,calls,get input(){return input;},get ai(){return ai;}};
}
test('chat binds every record query to the active workspace and performs no writes',async()=>{
 const f=fixture({answer:'Daniel is on your roster.',plan:null,email:null});const r=await f.ask([{role:'user',content:'Tell me about Daniel'}],'active-workspace');assert.ok(r.reply);
 for(const table of ['artists','releases','tasks','artist_briefs','workspace_contacts'])assert.ok(f.calls.some(c=>c[0]===table&&c[1]==='eq'&&c[2]==='workspace_id'&&c[3]==='active-workspace'));
 assert.equal(f.input.workspace.artists.length,1);assert.equal(f.input.workspace.artists[0].name,'Daniel');
});
test('stale workspace and invented artist or email destinations are rejected',async()=>{
 const f=fixture({answer:'Hidden',plan:null,email:null});assert.ok((await f.ask([{role:'user',content:'Hello'}],'other-workspace')).error);assert.equal(f.ai,0);assert.equal(f.calls.length,0);
 const g=fixture({answer:'Plan',plan:{artist_id:'hidden-id',artist_name:'Private'},email:null});assert.ok((await g.ask([{role:'user',content:'Create a release'}],'active-workspace')).error);
 const h=fixture({answer:'Email',plan:null,email:{recipient:'invented@example.com',subject:'Hello',body:'Hello'}});assert.ok((await h.ask([{role:'user',content:'Write an email'}],'active-workspace')).error);
});
test('explicit email address can be drafted with the real workspace owner signature',async()=>{
 const f=fixture({answer:'Review this message.',plan:null,email:{recipient:'chris@example.com',subject:'Studio availability',body:'Could you confirm availability?'}});
 const r=await f.ask([{role:'user',content:'Email chris@example.com asking about availability'}],'active-workspace');assert.equal(r.reply.email.body.endsWith('Alex Morgan'),true);
});
test('blank answers about an unavailable artist become a useful private response',async()=>{
 for(const answer of ['', '  \n\t']){
  const f=fixture({answer,plan:null,email:null});
  const r=await f.ask([{role:'user',content:'Tell me about Maya'}],'active-workspace');
  assert.match(r.reply.answer,/don’t have enough information/);
  assert.match(r.reply.answer,/records you can access/);
  assert.equal(r.reply.plan,null);assert.equal(r.reply.email,null);
  assert.equal(f.input.workspace.artists.some(a=>a.name==='Maya'),false);
  assert.doesNotMatch(r.reply.answer,/another manager|hidden|exists elsewhere/);
 }
});
test('blank proposal introductions describe review rather than missing information',async()=>{
 const f=fixture({answer:' ',plan:null,email:{recipient:'chris@example.com',subject:'Update',body:'Any update?'}});
 const r=await f.ask([{role:'user',content:'Email chris@example.com for an update'}],'active-workspace');
 assert.match(r.reply.answer,/Choose Send/);assert.match(r.reply.answer,/Nothing has been sent yet/);
});

test('email proposals explain the real Gmail send flow even if the model denies capability',async()=>{
 const f=fixture({answer:'I cannot send emails directly. Copy this email.',plan:null,email:{recipient:'chris@example.com',subject:'Update',body:'Any update?'}});
 const r=await f.ask([{role:'user',content:'Send an email to chris@example.com asking for an update'}],'active-workspace');
 assert.match(r.reply.answer,/connected Gmail/);assert.doesNotMatch(r.reply.answer,/cannot send|Copy this/);
});

test('complete plans with optional questions remain visible and past schedules are rejected',async()=>{
 const plan={artist_id:'allowed-id',artist_name:'Daniel',genre:'Pop',title:'Midnights',format:'Album',date:'2099-01-01',tasks:[{title:'Approve master',due_date:'2098-12-01'}],question:'Would you like to customize it?'};
 const f=fixture({answer:'Here is an outline',plan,email:null});
 const r=await f.ask([{role:'user',content:'Plan Midnights for Daniel'}],'active-workspace');
 assert.equal(r.reply.plan.question,'');assert.match(r.reply.answer,/Review the proposed album/);
 const g=fixture({answer:'Old outline',plan:{...plan,tasks:[{title:'Recording',due_date:'2020-08-22'}]},email:null});
 assert.match((await g.ask([{role:'user',content:'Plan Midnights'}],'active-workspace')).error,/past deadlines/);
});
