import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpile(await readFile('lib/ai/follow-up-message.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
const sandboxModule={exports:{}};
vm.runInNewContext(source,{module:sandboxModule,exports:sandboxModule.exports,AbortSignal,fetch,Date});
const {generateFollowUp,validatePreparedMessage}=sandboxModule.exports;
const message={subject:'Cover art update',body:'Hi Sophie, could you send an update on the cover artwork?',source_ids:['email1']};
const emails=[{id:'email1',subject:'Artwork',body:'Draft expected tomorrow'}];
const response=value=>({ok:true,json:async()=>value});
test('AI follow-up uses bounded supplied context and structured output',async()=>{
 let sent;
 const result=await generateFollowUp('test','test-model',{date:'2026-10-14'},emails,[],async(url,options)=>{sent=JSON.parse(options.body);return response({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(message)}]}]});});
 assert.equal(result.subject,message.subject);assert.equal(sent.store,false);assert.equal(sent.text.format.strict,true);
 assert.equal(JSON.parse(sent.input).emails[0].id,'email1');
});
test('refused, truncated, invalid and unsupported-source messages cannot become drafts',async()=>{
 for(const value of [{status:'incomplete',output:[]},{status:'completed',output:[{content:[{type:'refusal'}]}]},{status:'completed',output:[{content:[{type:'output_text',text:'not json'}]}]}])await assert.rejects(()=>generateFollowUp('test','test',{},[],[],async()=>response(value)));
 assert.throws(()=>validatePreparedMessage({...message,source_ids:['invented']},emails));
 assert.throws(()=>validatePreparedMessage({...message,subject:'Hello\nBcc: other'},emails));
});
const actionSource=ts.transpile(await readFile('app/workspace/draft-actions.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
const id='11111111-1111-4111-8111-111111111111';
function actionFixture({sends=[],emails=[],history=[{id,version:2,subject:'Old',body:'Old',task_id:id}],allowed=true}={}){
 let generated=0;const calls=[];
 const supabase={rpc:async(name)=>{calls.push(name);return {data:name==='workspace_sender_name'?'Owner Name':name==='review_task_email_snapshot'?{title:'Artwork',owner_email:'owner@example.com',owner_name:'Sophie',status:'Pending'}:allowed,error:null};},from(table){const q={};for(const key of ['select','eq','order','limit','in'])q[key]=()=>q;q.then=(resolve)=>Promise.resolve({data:table==='task_email_drafts'?history:table==='task_email_sends'?sends:emails,error:null}).then(resolve);return q;}};
 const mod={exports:{}};vm.runInNewContext(actionSource,{module:mod,exports:mod.exports,process:{env:{OPENAI_API_KEY:'test'}},crypto:{randomUUID:()=>id},require(name){if(name.includes('session'))return {requireWorkspace:async()=>({workspace:{id}}),requireUser:async()=>({supabase})};if(name.includes('signature'))return {signMessage:(body,name)=>body+'\n'+name};if(name.includes('follow-up-message'))return {generateFollowUp:async()=>{generated++;return {...message,source_ids:[]};}};return {uuidPattern:/^[a-f0-9-]{36}$/};}});
 return {prepare:mod.exports.prepareAiTaskMessage,calls,get generated(){return generated;}};
}
test('AI regeneration reuses the existing unsent draft without saving or sending',async()=>{const f=actionFixture();const r=await f.prepare(id,[]);assert.equal(r.draft.id,id);assert.equal(r.draft.version,2);assert.equal(r.draft.recipient,'owner@example.com');assert.equal(f.generated,1);assert.deepEqual(f.calls,['workspace_sender_name','review_task_email_snapshot','reserve_email_analysis']);});
test('uncertain sends, missing sources and denied allowance block AI generation',async()=>{
 for(const [options,ids] of [[{sends:[{draft_id:id,status:'unknown'}]},[]],[{},[id]],[{allowed:false},[]]]){const f=actionFixture(options);const r=await f.prepare(id,ids);assert.ok(r.error);assert.equal(f.generated,0);}
});
