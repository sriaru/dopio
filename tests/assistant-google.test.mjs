import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
async function action(path,modules){const source=ts.transpile(await readFile(path,'utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});const exports={};vm.runInNewContext(source,{exports,require:name=>modules[name]??{},process:{env:{}},URL,URLSearchParams,AbortSignal,Date});return exports;}
function session(){
 const calls=[];const supabase={from(table){const q={};for(const k of ['select','eq','order','limit'])q[k]=(...a)=>{calls.push([table,k,...a]);return q;};q.maybeSingle=async()=>({error:null,data:table==='google_calendar_runs'?null:{connection_id:'connection',calendar_id:'calendar',encrypted_refresh_token:'encrypted-test',email:'test@example.com'}});return q;}};
 return {calls,auth:{requireWorkspace:async()=>({workspace:{id:'w'},user:{id:'u'}}),requireUser:async()=>({supabase})}};
}
test('assistant Gmail search reads only the current connected member and reports provider failure',async()=>{
 const s=session();let fail=false;const paths=[];
 const api={tokenRequest:async()=>({access_token:'test-token'}),gmailGet:async path=>{paths.push(path);if(fail)throw new Error('Reconnect Gmail.');return path.startsWith('messages?')?{messages:[{id:'msg'}]}:{id:'msg'};},summarizeMessage:()=>({subject:'Daniel',sender:'Sender <sender@example.com>',received:'2026-10-19'}),messageText:()=>'<script>untrusted</script>'};
 const actions=await action('app/gmail/actions.ts',{'@/lib/auth/session':s.auth,'@/lib/gmail/config':{gmailConfig:()=>({key:'test'})},'@/lib/gmail/security':{unseal:()=> 'refresh-test'},'@/lib/gmail/api':api});
 const r=await actions.searchAssistantGmail('emails about Daniel');assert.equal(r.error,null);assert.equal(r.sources[0].record.body,'<script>untrusted</script>');assert.ok(paths[0].includes('maxResults=5'));assert.ok(s.calls.some(c=>c[2]==='user_id'&&c[3]==='u'));assert.ok(s.calls.some(c=>c[2]==='workspace_id'&&c[3]==='w'));assert.ok(!JSON.stringify(r).includes('test-token'));
 fail=true;const failed=await actions.searchAssistantGmail('Daniel');assert.equal(failed.sources.length,0);assert.ok(failed.error);
});
test('assistant Calendar filters external events against current record access and returns failures honestly',async()=>{
 const s=session();let fail=false;
 const actions=await action('app/calendar/actions.ts',{'@/lib/auth/session':s.auth,'@/lib/calendar/config':{calendarConfig:()=>({key:'test'})},'@/lib/gmail/security':{unseal:()=> 'refresh-test'},'@/lib/gmail/api':{tokenRequest:async()=>({access_token:'test-token'})},'@/lib/workspace/data':{loadWorkspace:async()=>({tasks:[{id:'allowed'}],releases:[]})},'@/lib/calendar/events':{eventId:(w,k,id)=>id,CalendarError:class extends Error{},calendarRequest:async()=>{if(fail)throw new Error('Reconnect Calendar.');return {items:[{id:'allowed',summary:'Artwork',start:{date:'2026-10-20'},end:{date:'2026-10-21'}},{id:'removed-member-record',summary:'Private'}]};}}});
 const r=await actions.assistantCalendarEvents();assert.equal(r.sources.length,1);assert.equal(r.sources[0].record.id,'allowed');assert.ok(!JSON.stringify(r).includes('Private'));assert.ok(s.calls.some(c=>c[2]==='user_id'&&c[3]==='u'));
 fail=true;const failed=await actions.assistantCalendarEvents();assert.equal(failed.sources.length,0);assert.ok(failed.error);
});
