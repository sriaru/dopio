"use client";
import {useState,type FormEvent} from 'react';
import {draftReleaseRevision,saveReleaseRevision} from '@/app/workspace/revision-actions';
import type {Revision,RevisionSnapshot} from '@/lib/ai/release-revision';
import type {WorkspaceData} from '@/lib/workspace/types';
export default function ReleaseRevisionPlanner({data,initialRelease,initialRequest,sourceNote,onSaved}:{onSaved?:(id:string)=>Promise<void>;data:WorkspaceData;initialRelease?:string;initialRequest?:string;sourceNote?:string}) {
 const [release,setRelease]=useState(initialRelease??'');const [input,setInput]=useState(initialRequest??'');
 const [messages,setMessages]=useState<{role:string;content:string}[]>([]);
 const [plan,setPlan]=useState<Revision|null>(null);const [snapshot,setSnapshot]=useState<RevisionSnapshot|null>(null);
 const [request,setRequest]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 function reset(){setPlan(null);setSnapshot(null);setMessages([]);setError('');setRequest('');}
 async function draft(e:FormEvent){
  e.preventDefault();if(busy)return;setBusy(true);setError('');
  const next=[...messages,{role:'user',content:input}];
  try{const r=await draftReleaseRevision(release,next);if(r.error)setError(r.error);else if(r.plan && r.snapshot){setPlan(r.plan);setSnapshot(r.snapshot);setRequest(crypto.randomUUID());setMessages([...next,{role:'assistant',content:r.plan.question||'Review the changes below.'}]);setInput('');}}
  catch{setError('Could not reach Dopio. Please try again.');}finally{setBusy(false);}
 }
 async function approve(){
  if(busy||!plan||!snapshot)return;setBusy(true);setError('');
  try{const r=await saveReleaseRevision(release,request,plan,snapshot,data.workspaceId);if(r.error)setError(r.error);else if(r.releaseId){
   if(onSaved){await onSaved(r.releaseId);return;}
   // eslint-disable-next-line @next/next/no-location-assign-relative-destination
   window.location.assign(`/?view=Releases&release=${encodeURIComponent(r.releaseId)}`);
  }}catch{setError('Save could not be confirmed. Retry this same approval before starting another draft.');}finally{setBusy(false);}
 }
 const changes=plan && snapshot ? [
  ...(['title','format','date'] as const).filter(k=>plan[k]!==snapshot.release[k]).map(k=>({label:`Release ${k}`,before:snapshot.release[k]||'Not set',after:plan[k]})),
  ...plan.tasks.flatMap(t=>{const old=snapshot.tasks.find(x=>x.id===t.id)!;return (['title','due_date'] as const).filter(k=>t[k]!==old[k]).map(k=>({label:`${old.title} · ${k==='title'?'title':'deadline'}`,before:old[k]||'Not set',after:t[k]||'Not set'}));}),
 ]:[];
 return <section className="panel release-plan"><div className="plan-heading"><div><p className="eyebrow">Dopio · REVISE A PLAN</p><h1>Plans change. Keep yours current.</h1><p>Describe a change, review it, then update the saved release.</p></div></div>
 <p className="email-mode-note">The selected release, open tasks, and artist brief context and preferences are sent to AI. This updates titles, format, and dates. Calendar sync and team emails remain separate review steps.</p>
 {sourceNote&&<p className="info-box">{sourceNote}</p>}
 <label className="revision-selector">Release<select disabled={busy||!!plan} value={release} onChange={e=>{setRelease(e.target.value);reset();}}><option value="">Choose a release</option>{data.releases.map(r=><option key={r.id} value={r.id}>{data.artists.find(a=>a.record_id===r.artist_id)?.name} — {r.title}</option>)}</select></label>
 {messages.map((m,i)=><div className="info-box" key={i}><strong>{m.role==='user'?'You':'Dopio'}</strong><p>{m.content}</p></div>)}
 {error && <p role="alert" className="auth-feedback error">{error}</p>}
 {(!plan||plan.question) && <form className="record-form" onSubmit={draft}><fieldset disabled={busy||!release}><label>What needs to change?<textarea value={input} onChange={e=>setInput(e.target.value)} required maxLength={6000} rows={4} placeholder="Move the release to November 12, 2026 and move each open task deadline seven days later."/></label><button className="button primary">{busy?'Drafting changes…':'Preview changes'}</button></fieldset></form>}
 {plan && !plan.question && <><h2>Review {changes.length} changes</h2>{changes.length?<div className="revision-table"><table><thead><tr><th>Detail</th><th>Current</th><th>Proposed</th></tr></thead><tbody>{changes.map((c,i)=><tr key={i}><th>{c.label}</th><td>{c.before}</td><td>{c.after}</td></tr>)}</tbody></table></div>:<p>No changes were proposed.</p>}<p>Task owners, completed tasks, and history are preserved. After saving, review calendar sync and prepare any updated team messages.</p><button className="button primary" disabled={busy||!changes.length} onClick={approve}>{busy?'Saving…':'Approve these changes'}</button></>}
 <div className="plan-actions"><button className="button secondary" disabled={busy} onClick={reset}>Start over</button></div><p>Drafts stay on this page until you leave or refresh.</p>
 </section>;
}
