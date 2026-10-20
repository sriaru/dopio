import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const url=code=>'data:text/javascript;base64,'+Buffer.from(ts.transpile(code,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022})).toString('base64');
const api=url(await readFile('lib/gmail/api.ts','utf8'));
const {findSentAttempt}=await import(url((await readFile('lib/gmail/reconcile.ts','utf8')).replace("'./api'",JSON.stringify(api))));
const attempt='11111111-1111-4111-8111-111111111111';
test('send reconciliation requires a unique SENT message with the exact attempt Message-ID',async()=>{
 let n=0;const fetcher=async(path)=>{
 if(++n===1){assert.match(decodeURIComponent(path),/rfc822msgid/);return Response.json({messages:[{id:'provider-id'}]});}
 return Response.json({labelIds:['SENT'],payload:{headers:[{name:'Message-ID',value:`<${attempt}@aura.local>`}]}});
 };
 assert.equal(await findSentAttempt('fixture',attempt,fetcher),'provider-id');
 for(const payload of [{},{messages:[{id:'1'},{id:'2'}]},{messages:[{id:'1'}],nextPageToken:'next'}])assert.equal(await findSentAttempt('fixture',attempt,async()=>Response.json(payload)),null);
 for(const payload of [{labelIds:['INBOX'],payload:{headers:[{name:'Message-ID',value:`<${attempt}@aura.local>`}]}},{labelIds:['SENT'],payload:{headers:[{name:'Message-ID',value:'<other@aura.local>'}]}}]){
 let count=0;assert.equal(await findSentAttempt('fixture',attempt,async()=>Response.json(++count===1?{messages:[{id:'id'}]}:payload)),null);
 }
 await assert.rejects(findSentAttempt('fixture',attempt,async()=>new Response(null,{status:403})),/denied/);
});

test('Dopio sends reconcile with either branding and never accept duplicate matches',async()=>{
 for(const domain of ['dopio.local','aura.local']){
 let calls=0;
 assert.equal(await findSentAttempt('fixture',attempt,async path=>{
 if(++calls===1){const q=new URL(path).searchParams.get('q');assert.ok(q.includes('@dopio.local'));assert.ok(q.includes('@aura.local'));return Response.json({messages:[{id:'sent'}]});}
 return Response.json({labelIds:['SENT'],payload:{headers:[{name:'Message-ID',value:`<${attempt}@${domain}>`}]}});
 }),'sent');
 }
 assert.equal(await findSentAttempt('fixture',attempt,async()=>Response.json({messages:[{id:'old'},{id:'new'}]})),null);
});
