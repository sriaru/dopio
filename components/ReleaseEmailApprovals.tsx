"use client";
import {DEFAULT_TIME_ZONE} from '@/lib/workspace/rules';
import {useRef,useState} from 'react';
import Link from 'next/link';
import {decideReleaseEmail} from '@/app/workspace/email-actions';
import type {WorkspaceData} from '@/lib/workspace/types';
import EmailProposalHistory from "./EmailProposalHistory";
import GoogleCalendarSync from './GoogleCalendarSync';
import TaskEmailDrafts from './TaskEmailDrafts';
export default function ReleaseEmailApprovals({data,messageId,proposalId,onData}:{data:WorkspaceData;messageId?:string;proposalId?:string;onData:(data:WorkspaceData)=>void}){
 const guard=useRef(false);const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const proposals=(data.email.releaseProposals??[]).filter(p=>(!messageId||p.message_id===messageId)&&(!proposalId||p.id===proposalId));
 async function decide(id:string,approve:boolean){
 if(guard.current)return;guard.current=true;setBusy(true);setError('');
 try{const r=await decideReleaseEmail(id,approve);if(r.error)setError(r.error);else if(r.data)onData(r.data);}
 catch{setError('Could not confirm the result. Refresh before retrying.');}
 finally{guard.current=false;setBusy(false);}
 }
 if(!proposals.length)return null;
 return <section aria-label="Release date approvals">
 {error&&<p className="auth-feedback error" role="alert">{error}</p>}
 {proposals.map(p=>{
 const source=data.email.messages.find(m=>m.id===p.message_id);
 const tasks=data.tasks.filter(t=>t.release_id===p.release_id&&t.status!=='Complete');
 const conflicts=tasks.filter(t=>t.due_date&&t.due_date>p.proposed_date);
 return <article id={`proposal-${p.id}`} className="panel release-plan" key={p.id}>
 <p className="eyebrow">{source?.source==='team'?'TEAM MESSAGE':'EMAIL'} → RELEASE UPDATE · {p.status}</p>
 <h2>{p.artist_name} · {p.release_title}</h2>
 <h3>Summary</h3>
 <p>Change the release date for {p.release_title} from {p.previous_date||'no date set'} to {p.proposed_date}. Linked task dates stay unchanged.</p>
 <EmailProposalHistory data={data} id={p.id}/>
 <div className="revision-table"><table><thead><tr><th>Change</th><th>Current at review</th><th>Proposed</th></tr></thead><tbody><tr><th>Release date</th><td>{p.previous_date||'Not set'}</td><td>{p.proposed_date}</td></tr></tbody></table></div>
 <details><summary>Source: {source?.subject||'Imported email'}</summary><p>From {source?.sender||'saved source'}</p><blockquote style={{whiteSpace:'pre-wrap'}}>{p.evidence}</blockquote></details>
 <details><summary>{tasks.length} linked open tasks · dates stay unchanged</summary><ul>{tasks.map(t=><li key={t.id}>{t.title} — {t.due_date||'No date'}{t.due_date&&t.due_date>p.proposed_date?' · Needs schedule review':''}</li>)}</ul></details>
 <p>The release’s Calendar event may need a new date. A saved date change appears in team chat. Calendar sync and outgoing emails require separate review.</p>
 {p.status==='pending'?<>
 {conflicts.length>0&&<p role="alert">Resolve {conflicts.length} task deadlines after the proposed release date before approving. No task dates will be shifted automatically.</p>}
 <div className="plan-actions"><button className="button primary" disabled={busy||conflicts.length>0} onClick={()=>decide(p.id,true)}>{busy?'Saving…':'Approve release date'}</button><button className="button secondary" disabled={busy} onClick={()=>decide(p.id,false)}>Reject</button></div>
 </>:<div className="info-box" role="status"><strong>{p.status==='approved'?'Release update completed':p.status==='rejected'?'Rejected':'Needs a new review'}</strong><p>{p.result}</p><p>{p.decided_at?new Date(p.decided_at).toLocaleString('en-US',{timeZone:data.timeZone??DEFAULT_TIME_ZONE}):''}</p></div>}
 {(conflicts.length>0||p.status==='conflict')&&<Link className="button secondary" href={'/?view=Dopio&emailReview='+encodeURIComponent(p.message_id)}>Review the release schedule</Link>}
 {p.status==='approved'&&<>
 <details><summary>Next: review Calendar synchronization</summary><GoogleCalendarSync data={data} releaseId={p.release_id}/></details>
 <details><summary>Next: prepare an email</summary><TaskEmailDrafts data={data} releaseId={p.release_id}/></details>
 </>}
 </article>;
 })}
 </section>;
}
