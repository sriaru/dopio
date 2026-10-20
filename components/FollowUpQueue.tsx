"use client";
import {DEFAULT_TIME_ZONE} from '@/lib/workspace/rules';
import {useRouter} from "next/navigation";
import {useEffect,useState} from 'react';
import {loadFollowUps} from '@/app/workspace/follow-up-actions';
import type {FollowUpRow} from '@/lib/workspace/follow-ups';
import type {WorkspaceData} from '@/lib/workspace/types';
import TaskEmailDrafts from './TaskEmailDrafts';
const labels={check_send:'Check send result',missing_owner:'Choose recipient',missing_email:'Add recipient email',draft:'Draft ready to review',sent:'Previously sent',ready:'Ready to prepare'};
export default function FollowUpQueue({data,onOwners,onManagers,today}:{data:WorkspaceData;onOwners:()=>void;onManagers:()=>void;today:string}){
 const router=useRouter();
 const [result,setResult]=useState<{error:string|null;rows:FollowUpRow[];snapshot:WorkspaceData;day:string}|null>(null);
 const [revision,setRevision]=useState(0),[filter,setFilter]=useState('All');
 const [selected,setSelected]=useState<FollowUpRow|null>(null);
 useEffect(()=>{let active=true;loadFollowUps().then(r=>{if(active)setResult({...r,snapshot:data,day:today});}).catch(()=>{if(active)setResult({snapshot:data,day:today,rows:[],error:'Could not load follow-ups. Refresh to try again.'});});return()=>{active=false;};},[revision,data,today]);
 function refresh(){setResult(null);setRevision(r=>r+1);}
 if(selected)return <div className="follow-up-page"><button className="button secondary" onClick={()=>{if(window.confirm('Return to follow-ups? Unsaved message edits will be lost.')){setSelected(null);refresh();}}}>← Back to follow-ups</button><TaskEmailDrafts key={selected.id} data={data} initialTaskId={selected.id} initialDraftId={selected.draftId??undefined}/></div>;
 const current=result?.snapshot===data&&result.day===today?result:null;
 const rows=current?.rows??[];
 const visible=rows.filter(r=>filter==='All'||(filter==='Overdue'&&r.overdue)||(filter==='Actionable overdue'&&r.actionableOverdue)||(filter==='Missing managers'&&r.missingManager)||(filter==='Check sends'&&r.state==='check_send')||(filter==='Missing recipients'&&r.missingRecipient));
 return <section className="follow-up-page">
 <div className="page-heading"><div><p className="eyebrow">KEEP WORK MOVING</p><h2>Follow-ups & email drafts</h2><p className="subtitle">Decisions, deadlines, and follow-ups that need your attention.</p></div><button className="button secondary" onClick={refresh} disabled={!current}>Refresh</button></div>

 {!current?<p role="status">Loading follow-up recipients and send history…</p>:current.error?<p role="alert" className="auth-feedback error">{current.error}</p>:<>
 <div className="follow-up-summary"><span><strong>{rows.filter(r=>r.overdue).length}</strong> overdue tasks</span><span><strong>{rows.filter(r=>r.actionableOverdue).length}</strong> actionable overdue follow-ups</span><span><strong>{rows.filter(r=>r.missingManager).length}</strong> missing managers</span><span><strong>{rows.filter(r=>r.state==='check_send').length}</strong> sends to check</span><span><strong>{rows.filter(r=>r.missingRecipient).length}</strong> recipient details missing</span></div>
 <div className="tabs" role="group" aria-label="Filter follow-ups">{['All','Overdue','Actionable overdue','Missing managers','Check sends','Missing recipients'].map(f=><button key={f} aria-pressed={filter===f} className={filter===f?'selected':''} onClick={()=>setFilter(f)}>{f}</button>)}</div>
 <p className="follow-up-help">Send history is not proof of delivery or a reply. Check the email thread before following up again. Dates use {data.timeZone??DEFAULT_TIME_ZONE}. Actionable overdue means an overdue task with a manager, a recipient email and no uncertain send. Previously sent messages still require checking for a reply; this count does not authorize another send.</p>
 <div className="panel">{!visible.length?<div className="live-empty"><h2>{rows.length?'No tasks match this filter.':'No open tasks to follow up.'}</h2><p>Open tasks appear here with their manager and message history. Completed tasks remain in Tasks.</p><button className="button secondary" onClick={()=>router.push("/?view=Tasks")}>View tasks</button></div>:visible.map(row=><article key={row.id} className="follow-up-row"><div><span className={`badge ${row.state==='check_send'?'red':'slate'}`}>{labels[row.state]}</span><h2>{row.title}</h2><p>{data.artists.find(a=>a.record_id===row.artist_id)?.name??'General task'}{row.release_id?` · ${data.releases.find(r=>r.id===row.release_id)?.title??'Project'}`:''}</p><p>Manager: {row.manager_names?.join(", ") || "No manager assigned"}</p>{row.missingManager&&<button className="text-link" onClick={()=>row.artist_id?onManagers():router.push('/?view=Tasks')}>{row.artist_id?'Ask the owner to assign an artist manager':'Link this task to an artist in Tasks'}</button>}<p>Follow-up recipient: {row.owner}{row.email?` · ${row.email}`:''}</p><p className={row.overdue?'follow-up-overdue':''}>{row.due_date?`Due ${row.due_date}${row.overdue?' · Overdue':''}`:'No confirmed deadline'}</p>{row.lastSentAt&&<p>Last recorded send: {new Date(row.lastSentAt).toLocaleString('en-US',{timeZone:data.timeZone??DEFAULT_TIME_ZONE})} ({data.timeZone??DEFAULT_TIME_ZONE})</p>}</div><button className="button secondary" onClick={()=>['missing_owner','missing_email'].includes(row.state)?onOwners():setSelected(row)}>{row.state==='check_send'?'Check send':row.state==='missing_owner'||row.state==='missing_email'?'Manage recipients':row.state==='draft'?'Open draft':row.state==='sent'?'Review last message':'Prepare message'}</button></article>)}</div></>}
 </section>;
}
