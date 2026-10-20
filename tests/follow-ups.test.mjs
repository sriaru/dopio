import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const policy=ts.transpile(await readFile('lib/workspace/rules.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
const policyUrl='data:text/javascript;base64,'+Buffer.from(policy).toString('base64');
const src=ts.transpile(await readFile('lib/workspace/follow-ups.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
const {buildFollowUps}=await import('data:text/javascript;base64,'+Buffer.from(src.replace("'./rules'",JSON.stringify(policyUrl))).toString('base64'));
const task={id:'t',title:'Artwork',due_date:'2026-10-10',status:'Pending',artist_id:'a',release_id:'r',owner_contact_id:'o'};
const owner={id:'o',name:'Designer',email:'designer@example.com'};
const draft={id:'d',task_id:'t',updated_at:'2026-10-11T10:00:00Z'};
const send={draft_id:'d',created_at:'2026-10-11T10:00:00Z',status:'sent'};
const rows=(tasks=[task],owners=[owner],drafts=[],sends=[])=>buildFollowUps(tasks,owners,drafts,sends,'2026-10-12');
test('follow-ups exclude completed work, flag overdue dates, and retain undated work',()=>{
 assert.equal(rows([{...task,status:'Complete'}]).length,0);
 assert.equal(rows()[0].overdue,true);
 assert.equal(rows([{...task,due_date:'2026-10-12'}])[0].overdue,false);
 assert.equal(rows([{...task,due_date:null}])[0].state,'ready');
});
test('missing owner and missing address route to assignment instead of drafting',()=>{
 assert.equal(rows([task],[])[0].state,'missing_owner');
 assert.equal(rows([task],[{...owner,email:' '}])[0].state,'missing_email');
});
test('any uncertain attempt wins over newer sent messages, drafts, and missing owners',()=>{
 const ds=[draft,{...draft,id:'new',updated_at:'2026-10-12T12:00:00Z'},{...draft,id:'unsent'}];
 const ss=[{...send,status:'unknown'},{...send,draft_id:'new',created_at:'2026-10-12T12:00:00Z'}];
 const row=rows([task],[],ds,ss)[0];
 assert.equal(row.state,'check_send');assert.equal(row.draftId,'d');assert.equal(row.lastSentAt,ss[1].created_at);
});
test('saved drafts reopen, historical sends do not imply replies, and unrelated sends are ignored',()=>{
 assert.equal(rows([task],[owner],[draft],[])[0].state,'draft');
 assert.equal(rows([task],[owner],[draft],[send])[0].state,'sent');
 assert.equal(rows([task],[owner],[draft],[{...send,draft_id:'other'}])[0].state,'draft');
});
test('uncertain sends sort first even when their deadlines are in the future',()=>{
 const future={...task,id:'future',due_date:'2026-12-01'};
 const r=rows([task,future],[owner],[{...draft,task_id:'future'}],[{...send,status:'sending'}]);
 assert.equal(r[0].id,'future');assert.equal(r[1].id,'t');
});
