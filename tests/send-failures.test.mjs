import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpile(await readFile('app/workspace/send-actions.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
function fixture({claim=true,request=async()=>Response.json({id:'provider'}),finishError=null,storageError=false}={}){
 const calls=[];let requests=0;
 const supabase={from(table){const q={};for(const k of ['select','eq'])q[k]=()=>q;q.single=async()=>({data:table==='gmail_connections'?{email:'sender@example.com',connection_id:'connection',can_send:true,encrypted_refresh_token:'refresh'}:{id:'draft',version:1,recipient:'recipient@example.com',subject:'Update',body:'Message'}});return q;},async rpc(name,args){calls.push({name,args});return name==='claim_task_email_send'?{data:claim,error:null}:{error:finishError};}};
 const sandboxModule={exports:{}};
 vm.runInNewContext(source,{module:sandboxModule,exports:sandboxModule.exports,Date,JSON,Number,AbortSignal,fetch:async(...args)=>{requests++;return request(...args);},require(name){
 if(name.includes('/receipts'))return {assertReceiptStorage:async()=>{if(storageError)throw Error("configuration");},recordSend:async(kind,w,u,a,p,outcome)=>{calls.push({name:'finish_task_email_send',args:{p_provider:p,outcome}});return {error:finishError};}};
 if(name==='node:crypto')return {randomUUID:()=> 'attempt'};
 if(name.includes('session'))return {requireWorkspace:async()=>({workspace:{id:'w'},user:{id:'u'}}),requireUser:async()=>({supabase})};
 if(name.includes('/config'))return {gmailConfig:()=>({key:'key',clientId:'client',clientSecret:'secret'})};
 if(name.includes('/security'))return {unseal:value=>value==='refresh'?'token':JSON.stringify({id:'draft',version:1,connection:'connection',expires:Date.now()+60000})};
 if(name.includes('/api'))return {tokenRequest:async()=>({access_token:'access'})};
 if(name.includes('/outgoing'))return {encodeOutgoing:()=> 'encoded'};
 return {};
 }});
 return {send:()=>sandboxModule.exports.sendReviewedTaskEmail('ticket'),calls,count:()=>requests};
}
test('a duplicate claim never calls Gmail send',async()=>{
 const f=fixture({claim:false});const result=await f.send();assert.ok(result.error);assert.equal(f.count(),0);
});
test('a network failure after claiming records unknown and never retries Gmail',async()=>{
 const f=fixture({request:async()=>{throw Error('network');}});const result=await f.send();
 assert.match(result.error,/uncertain/);assert.equal(f.count(),1);
 const finish=f.calls.find(c=>c.name==='finish_task_email_send');assert.equal(finish.args.p_provider,null);
});
test('a Gmail success with a database confirmation failure does not claim success or resend',async()=>{
 const f=fixture({finishError:{code:'network'}});const result=await f.send();
 assert.match(result.error,/Google accepted/);assert.equal(f.count(),1);assert.equal(f.calls.filter(c=>c.name==='claim_task_email_send').length,1);
});

test('missing trusted receipt storage fails before claiming or sending',async()=>{
 const f=fixture({storageError:true});assert.match((await f.send()).error,/receipt storage/);assert.equal(f.count(),0);assert.equal(f.calls.length,0);
});
test('Google rejection is persisted distinctly and never automatically retried',async()=>{
 const f=fixture({request:async()=>new Response('',{status:403})});assert.match((await f.send()).error,/Google rejected/);assert.equal(f.count(),1);assert.equal(f.calls.at(-1).args.outcome,'rejected');
});
