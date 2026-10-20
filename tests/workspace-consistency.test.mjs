import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const compile=async path=>ts.transpile(await readFile(path,'utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
const url=src=>'data:text/javascript;base64,'+Buffer.from(src).toString('base64');
const policyUrl=url(await compile('lib/workspace/rules.ts'));
const {workspaceDay,isOverdueTask,isCompletedTask,isMissingManager,isCalendarTask,isActiveProject,isUpcomingRelease,withinNextSevenDays,matchesTaskFilter,activeRecords}=await import(policyUrl);
const {buildFollowUps}=await import(url((await compile('lib/workspace/follow-ups.ts')).replace("'./rules'",JSON.stringify(policyUrl))));
const today='2026-10-14';
const task={id:'t',title:'Master',status:'Pending',due_date:'2026-10-13',artist_id:'a',release_id:'r',owner_contact_id:'c',manager_names:['Alex']};
const project={id:'r',artist_id:'a',title:'Daybreak',format:'Album',status:'Planning',release_date:'2026-10-20'};
test('Central workspace day stays consistent across UTC midnight and DST transitions',()=>{
 for(const [instant,expected] of [['2026-10-14T02:00:00Z','2026-10-13'],['2026-10-14T05:00:00Z','2026-10-14'],['2026-03-08T05:59:59Z','2026-03-07'],['2026-03-08T08:00:00Z','2026-03-08'],['2026-11-01T07:30:00Z','2026-11-01']])assert.equal(workspaceDay(new Date(instant),'America/Chicago'),expected);
 assert.equal(workspaceDay(new Date('2026-10-14T02:00:00Z'),'UTC'),'2026-10-14');
});
test('dashboard overdue count equals Tasks overdue filter and follow-up overdue count',()=>{
 const tasks=[task,{...task,id:'today',due_date:today},{...task,id:'done',status:'Complete'},{...task,id:'undated',due_date:null},{...task,id:'archived',archived_at:'2026-10-12'}];
 const queue=buildFollowUps(tasks,[{id:'c',name:'Designer',email:'d@example.com'}],[],[],today);
 assert.equal(tasks.filter(t=>isOverdueTask(t,today)).length,1);
 assert.equal(tasks.filter(t=>matchesTaskFilter(t,'Overdue',today)).length,1);
 assert.equal(queue.filter(r=>r.overdue).length,1);
 assert.equal(tasks.filter(isCompletedTask).length,1);
 assert.equal(tasks.filter(isCalendarTask).length,2);
 assert.equal(queue.length,3);
});
test('next seven days means today through day six, not eight inclusive dates',()=>{
 assert.equal(withinNextSevenDays({...task,due_date:today},today),true);
 assert.equal(withinNextSevenDays({...task,due_date:'2026-10-20'},today),true);
 assert.equal(withinNextSevenDays({...task,due_date:'2026-10-21'},today),false);
 assert.equal(withinNextSevenDays({...task,due_date:null},today),false);
});
test('upcoming releases exclude past, undated, released, archived and non-music projects',()=>{
 assert.equal(isUpcomingRelease(project,today),true);
 for(const change of [{release_date:null},{release_date:'2026-10-13'},{status:'Released'},{archived_at:'x'},{format:'Tour'}])assert.equal(isUpcomingRelease({...project,...change},today),false);
 assert.equal(isActiveProject({...project,format:'Tour',release_date:null}),true);
});
test('manager ownership and recipient readiness are independent, including uncertain sends',()=>{
 const tasks=[task,{...task,id:'no-manager',manager_names:[]},{...task,id:'no-recipient',owner_contact_id:null},{...task,id:'uncertain',owner_contact_id:null}];
 const rows=buildFollowUps(tasks,[{id:'c',name:'Designer',email:'d@example.com'}],[{id:'d',task_id:'uncertain',updated_at:'2026-10-14'}],[{draft_id:'d',status:'unknown',created_at:'2026-10-14'}],today);
 assert.equal(tasks.filter(isMissingManager).length,1);
 assert.equal(rows.filter(r=>r.missingManager).length,1);
 assert.equal(rows.filter(r=>r.missingRecipient).length,2);
 assert.equal(rows.filter(r=>r.actionableOverdue).length,1);
 assert.equal(rows.find(r=>r.id==='uncertain').state,'check_send');
 assert.equal(isMissingManager({...task,status:'Complete',manager_names:[]}),false);
});
test('archived or inaccessible parents are excluded consistently, including indirect artist links',()=>{
 const input=[task,{...task,id:'indirect',artist_id:null},{...task,id:'general',artist_id:null,release_id:null}];
 const visible=activeRecords([{record_id:'a',archived_at:'x'}],[project],input);
 assert.deepEqual(visible.tasks.map(t=>t.id),['general']);assert.equal(visible.releases.length,0);
 assert.deepEqual(activeRecords([],[],input).tasks.map(t=>t.id),['general']);
 assert.equal(input[0].due_date,'2026-10-13');assert.deepEqual(input[0].manager_names,['Alex']);
});
