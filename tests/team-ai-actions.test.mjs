import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const code=ts.transpile(readFileSync('app/workspace/team-ai-actions.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022});
const artist='11111111-1111-4111-8111-111111111111';
function fixture({taskCount=201,access=true}={}){
 const tables=[],calls=[];
 const supabase={
  rpc:async name=>({error:null,data:name==='artist_ai_messages'?[{id:1,body:'Artwork delayed',kind:'message'}]:name==='can_access_artist'?access:true}),
  from(table){
   tables.push(table);
   const data=table==='tasks'?Array.from({length:taskCount},(_,i)=>({id:String(i),title:'Artwork',version:1})):[];
   const query={select(){return this;},eq(){return this;},is(){return this;},neq(){return this;},limit:async()=>({error:null,data}),single:async()=>({error:null,data:{time_zone:'America/Chicago'}})};
   return query;
  }
 };
 const dependencies={
  '@/lib/auth/session':{requireWorkspace:async()=>({workspace:{id:'workspace'}}),requireUser:async()=>({supabase})},
  '@/lib/workspace/validation':{uuidPattern:/^[0-9a-f-]{36}$/},
  '@/lib/ai/team-messages':{analyzeTeamMessages:async(...args)=>{calls.push(args);return {points:[],actions:[]};}}
 };
 const exports={};runInNewContext(code,{exports,require:name=>{assert.ok(dependencies[name]);return dependencies[name];},process:{env:{OPENAI_API_KEY:'test-only'}}});
 return {run:mode=>exports.teamMessageInsight('workspace',artist,mode),tables,calls};
}
test('unread summary succeeds with 201 tasks without querying action targets',async()=>{
 const f=fixture();const result=await f.run('summary');assert.ok(result.result);assert.equal(result.error,undefined);
 assert.deepEqual(f.tables,['workspaces']);assert.equal(f.calls.length,1);assert.equal(f.calls[0][3].length,0);assert.equal(f.calls[0][4],'America/Chicago');
});
test('action extraction retains record limit and does not call AI on overflow',async()=>{
 const f=fixture();assert.match((await f.run('actions')).error,/too many/);assert.equal(f.calls.length,0);
});
test('action extraction still provides persisted targets within the limit',async()=>{
 const f=fixture({taskCount:1});assert.ok((await f.run('actions')).result);assert.equal(f.calls[0][3][0].id,'0');
});
test('summary result is withheld when artist access is revoked during analysis',async()=>{
 const f=fixture({access:false});const result=await f.run('summary');assert.match(result.error,/access changed/);assert.equal(result.result,undefined);
});
