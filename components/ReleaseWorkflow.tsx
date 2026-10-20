"use client";
import {useEffect,useState} from 'react';
import type {WorkspaceData,ReleaseRecord} from '@/lib/workspace/types';
import {releaseWorkflowStatus} from '@/app/workspace/workflow-actions';
import WorkspaceContacts from './WorkspaceContacts';
import GoogleCalendarSync from './GoogleCalendarSync';
import TaskEmailDrafts from './TaskEmailDrafts';
export default function ReleaseWorkflow({data,release}:{data:WorkspaceData;release:ReleaseRecord}){
 const [step,setStep]=useState<number|null>(null);
 const [revision,setRevision]=useState(0);const [synced,setSynced]=useState<string|null>(null);
 const calendarKey=JSON.stringify([release.id,release.version,data.tasks.filter(t=>t.release_id===release.id).map(t=>[t.id,t.version])]);
 const [loaded,setLoaded]=useState<{value:Awaited<ReturnType<typeof releaseWorkflowStatus>>;releaseId:string;tasks:WorkspaceData['tasks'];revision:number}|null>(null);
 const status=loaded?.releaseId===release.id&&loaded.tasks===data.tasks&&loaded.revision===revision?loaded.value:null;
 const refresh=()=>setRevision(r=>r+1);
 useEffect(()=>{let active=true;releaseWorkflowStatus(release.id).then(r=>{if(active)setLoaded({value:r,releaseId:release.id,tasks:data.tasks,revision});}).catch(()=>{if(active)setLoaded({value:{error:'Could not refresh progress.'},releaseId:release.id,tasks:data.tasks,revision});});return()=>{active=false;};},[release.id,revision,data.tasks]);
 const cards=[
  {title:'Choose recipients',description:status && !status.error?`${status.assigned} of ${status.total} tasks with a recipient email`:status?.error?'Recipients unavailable':'Loading recipients…',mark:'01'},
  {title:'Sync calendar',description:synced===calendarKey?'Synced this visit · review after edits':'Review the dates in Google',mark:'02'},
  {title:'Update your team',description:status && !status.error?`${status.drafted} tasks drafted · ${status.sent} with sent email`:status?.error?'Updates unavailable':'Loading team updates…',mark:'03'},
 ];
 return <section className="panel release-workflow">
 <div className="workflow-heading"><div><p className="eyebrow">NEXT STEPS</p><h2>Bring your team into the plan</h2></div><button type="button" className="text-link" onClick={refresh}>Refresh progress</button></div>
 <p>Choose a step to coordinate {release.title}.</p>
 <div className="workflow-steps" role="group" aria-label="Release workflow steps">{cards.map((card,i)=><button type="button" key={card.title} className={step===i?'selected':''} aria-expanded={step===i} aria-controls={`workflow-${release.id}-${i}`} onClick={()=>{setStep(step===i?null:i);refresh();}}><span className="workflow-number">{card.mark}</span><strong>{card.title}</strong><span>{card.description}</span><span className="workflow-open">{step===i?'Close ↑':'Open →'}</span></button>)}</div>
 {status?.error && <p role="alert" className="auth-feedback error">{status.error}</p>}
 {!!status?.uncertain && <p role="alert">{status.uncertain} send attempts need checking in Gmail Sent before any further action.</p>}
 <div id={`workflow-${release.id}-0`} hidden={step!==0}><WorkspaceContacts data={data} releaseId={release.id} onChanged={refresh}/></div>
 <div id={`workflow-${release.id}-1`} hidden={step!==1}><GoogleCalendarSync data={data} releaseId={release.id} onSynced={()=>setSynced(calendarKey)}/></div>
 <div id={`workflow-${release.id}-2`} hidden={step!==2}><TaskEmailDrafts data={data} releaseId={release.id} onChanged={refresh}/></div>
 {step!==null && <div className="workflow-footer"><p>Save drafts before leaving. After changing a deadline, sync your calendar and review a new team update.</p>{step<2 && <button type="button" className="button primary" onClick={()=>{setStep(step+1);refresh();}}>Next: {step===0?'calendar':'team updates'} →</button>}</div>}
 <details className="workflow-help"><summary>How progress is counted</summary><p>Counts cover open tasks. Drafts and sent emails are snapshots of earlier details, so a sent email does not confirm the recipient has the latest deadline. Calendar status reflects only this visit. Connecting Google leaves this page; save your drafts first.</p></details>
 </section>;
}
