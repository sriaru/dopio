import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpile(await readFile('app/workspace/chat-email-actions.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
const id='11111111-1111-4111-8111-111111111111';
function fixture({claim=true,network=false,finishError=false}={}){
 let sends=0;const calls=[];
 const supabase={from(){return {select(){return this;},eq(){return this;},single:async()=>({data:{email:'sender@example.com',connection_id:id,encrypted_refresh_token:'fake',can_send:true},error:null})};},rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='workspace_role'?'manager':name==='save_chat_message'?1:name==='claim_chat_message'?claim:null,error:name==='finish_chat_message'&&finishError?{}:null};}};
 const mod={exports:{}};vm.runInNewContext(source,{module:mod,exports:mod.exports,AbortSignal,require(name){if(name.includes('/receipts'))return {assertReceiptStorage:async()=>{},recordSend:async(kind,w,u,a,p)=>{calls.push(['finish_chat_message',{p}]);return {error:finishError?{}:null};}};if(name==='node:crypto')return {randomUUID:()=>id};if(name.includes('session'))return {requireWorkspace:async()=>({workspace:{id:'w'},user:{id:'u'}}),requireUser:async()=>({supabase})};if(name.includes('validation'))return {uuidPattern:/^[a-f0-9-]{36}$/};if(name.includes('config'))return {gmailConfig:()=>({key:'fake'})};if(name.includes('security'))return {unseal:()=> 'fake'};if(name.includes('api'))return {tokenRequest:async()=>({access_token:'fake'})};return {encodeOutgoing:()=> 'fake'};},fetch:async()=>{sends++;if(network)throw new Error('network');return {ok:true,json:async()=>({id:'gmail-message'})};}});
 return {send:()=>mod.exports.sendChatEmail({id,version:0,recipient:'to@example.com',subject:'Hello',body:'Hello'},'w'),calls,get sends(){return sends;}};
}
test('chat duplicate claim never calls Gmail',async()=>{const f=fixture({claim:false});assert.ok((await f.send()).error);assert.equal(f.sends,0);});
test('chat uncertain provider result records unknown and never retries',async()=>{const f=fixture({network:true});const r=await f.send();assert.ok(r.locked);assert.equal(f.sends,1);assert.ok(f.calls.some(([name,args])=>name==='finish_chat_message'&&args.p===null));});
test('chat provider success with failed confirmation remains locked',async()=>{const f=fixture({finishError:true});const r=await f.send();assert.ok(r.error);assert.ok(r.locked);assert.equal(f.sends,1);});
