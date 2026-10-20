import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpile(await readFile('app/workspace/draft-actions.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
function fixture(responses){
 const calls=[];
 const supabase={from(table){calls.push([table]);const query={};for(const key of ['select','eq','order','limit','in'])query[key]=(...args)=>{calls.push([key,...args]);return query;};query.then=(resolve,reject)=>Promise.resolve(responses[table]).then(resolve,reject);return query;}};
 const sandboxModule={exports:{}};
 vm.runInNewContext(source,{module:sandboxModule,exports:sandboxModule.exports,require(name){if(name.includes('session'))return {requireWorkspace:async()=>({workspace:{id:'workspace'}}),requireUser:async()=>({supabase})};return {uuidPattern:/^[a-f0-9-]{36}$/};}});
 return {list:sandboxModule.exports.listTaskDrafts,calls};
}
const id='11111111-1111-4111-8111-111111111111';
test('drafts fail closed if send status cannot be verified',async()=>{
 const {list}=fixture({task_email_drafts:{data:[{id,task_id:'task'}],error:null},task_email_sends:{data:null,error:{code:'network'}}});
 const result=await list();assert.ok(result.error);assert.equal(result.drafts.length,0);
});
test('empty draft lists do not make an invalid empty send-history query',async()=>{
 const {list,calls}=fixture({task_email_drafts:{data:[],error:null}});
 const result=await list();assert.equal(result.error,null);assert.equal(result.drafts.length,0);
 assert.equal(calls.some(c=>c[0]==='task_email_sends'),false);
});
test('opening a specific old draft filters by workspace and ID and retains its send lock',async()=>{
 const {list,calls}=fixture({task_email_drafts:{data:[{id,task_id:'task'}],error:null},task_email_sends:{data:[{draft_id:id,status:'unknown'}],error:null}});
 const result=await list(id);assert.equal(result.drafts[0].send_status,'unknown');
 assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='workspace_id'&&c[2]==='workspace'));
 assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='id'&&c[2]===id));
});
test('message history is filtered to the selected task',async()=>{
 const {list,calls}=fixture({task_email_drafts:{data:[],error:null}});
 await list(undefined,id);
 assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='task_id'&&c[2]===id));
});
