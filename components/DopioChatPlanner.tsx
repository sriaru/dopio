"use client";
import {useState, type FormEvent} from 'react';
import {draftChatPlan,saveChatPlan} from '@/app/workspace/chat-actions';
import type {Plan} from '@/lib/ai/release-plan';
import type {WorkspaceData} from '@/lib/workspace/types';
export default function DopioChatPlanner({data,today}:{data:WorkspaceData;today:string}) {
 const [messages,setMessages]=useState<{role:string;content:string}[]>([]);
 const [input,setInput]=useState('');
 const [plan,setPlan]=useState<Plan|null>(null);
 const [request,setRequest]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [saving,setSaving]=useState(false);
 const [briefArtist,setBriefArtist]=useState('');
 async function send(e:FormEvent) {
  e.preventDefault(); if(busy || !input.trim()) return;
  setBusy(true);setError('');
  const next=[...messages,{role:'user',content:input.trim()}];
  try {
   const result=await draftChatPlan(next,briefArtist);
   if(result.error) setError(result.error);
   else if(result.plan) {
    const p=result.plan;setPlan(p);setRequest(crypto.randomUUID());setInput('');
    setMessages([...next,{role:'assistant',content:p.question || `Draft ready for ${p.artist_name}: ${p.title} (${p.format}), ${p.date}. Review the suggested tasks below.`}]);
   }
  } catch {setError('Could not reach Dopio. Your request is still here; try again.');}
  finally {setBusy(false);}
 }
 async function approve(e:FormEvent) {
  e.preventDefault();if(!plan || busy) return;setBusy(true);setSaving(true);setError('');
  try {
   const result=await saveChatPlan(request,plan);
   if(result.error) setError(result.error);
   else if(result.releaseId) {
    // Full navigation refreshes the workspace snapshot after the atomic save.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/?view=Releases&release=${encodeURIComponent(result.releaseId)}`);
   }
  } catch {setError('Save could not be confirmed. Retry this same plan to avoid duplicates.');}
  finally {setBusy(false);}
 }
 function edit(patch:Partial<Plan>) {if(plan)setPlan({...plan,...patch});}
 return <section className="panel release-plan">
  <div className="plan-heading"><div><p className="eyebrow">Dopio · AI RELEASE PLANNER</p><h1>Tell Dopio what you’re planning.</h1><p>Create an artist, release, and tasks from one conversation.</p></div></div>
  <p className="email-mode-note">Your request, artist roster, and selected brief context and preferences are sent to AI. Review before saving; then use the release checklist to sync your calendar and prepare team updates.</p>
  <label className="revision-selector">Artist brief (optional)<select value={briefArtist} disabled={busy||!!messages.length||!!plan} onChange={e=>setBriefArtist(e.target.value)}><option value="">No brief — use my request</option>{data.artists.map(a=><option key={a.record_id} value={a.record_id}>{a.name}</option>)}</select></label>
  <div aria-live="polite">{messages.map((m,i)=><div className="info-box" key={i}><strong>{m.role==='user'?'You':'Dopio'}</strong><p style={{whiteSpace:'pre-wrap'}}>{m.content}</p></div>)}</div>
  {error && <p role="alert" className="auth-feedback error">{error}</p>}
  {(!plan || plan.question) && <form className="record-form" onSubmit={send}><fieldset disabled={busy}><label>Your request<textarea required maxLength={6000} rows={4} value={input} onChange={e=>setInput(e.target.value)} placeholder="Create a new pop artist named Daniel and plan his album release for November 5, 2026." /></label><button className="button primary">{busy?'Thinking…':'Ask Dopio'}</button></fieldset></form>}
  {plan && !plan.question && <form className="record-form" onSubmit={approve}><fieldset disabled={busy || saving}>
   <h2>Review your plan</h2><p>{plan.artist_id?'Uses an existing artist.':'Creates a new artist.'} Creates one release and {plan.tasks.length} tasks after approval.</p>
   <div className="plan-details">
    <label>Artist<select value={plan.artist_id || ''} onChange={e=>{const a=data.artists.find(a=>a.record_id===e.target.value);edit({artist_id:a?.record_id||null,artist_name:a?.name||plan.artist_name,genre:a?.genre||plan.genre});}}><option value="">Create a new artist</option>{data.artists.map(a=><option key={a.record_id} value={a.record_id}>{a.name}</option>)}</select></label>
    <label>Artist name<input required maxLength={100} disabled={!!plan.artist_id} value={plan.artist_name} onChange={e=>edit({artist_name:e.target.value})}/></label>
    <label>Genre<input maxLength={100} disabled={!!plan.artist_id} value={plan.genre} onChange={e=>edit({genre:e.target.value})}/></label>
    <label>Release title<input required maxLength={150} value={plan.title} onChange={e=>edit({title:e.target.value})}/></label>
    <label>Format<select value={plan.format} onChange={e=>edit({format:e.target.value})}>{['Single','EP','Album'].map(f=><option key={f}>{f}</option>)}</select></label>
    <label>Release date<input type="date" required min="1900-01-01" max="2199-12-31" value={plan.date} onChange={e=>edit({date:e.target.value})}/></label>
   </div>
   <p>These task dates are suggestions. Changing the release date does not automatically move them.</p>
   {plan.tasks.map((t,i)=><div className="plan-task" key={i}><label>Task {i+1}<input required maxLength={150} value={t.title} onChange={e=>edit({tasks:plan.tasks.map((x,j)=>i===j?{...x,title:e.target.value}:x)})}/></label><label>Deadline<input required type="date" min="1900-01-01" max={plan.date} value={t.due_date} onChange={e=>edit({tasks:plan.tasks.map((x,j)=>i===j?{...x,due_date:e.target.value}:x)})}/></label><button type="button" className="button secondary" disabled={plan.tasks.length<=1} onClick={()=>edit({tasks:plan.tasks.filter((_,j)=>j!==i)})}>Remove</button></div>)}
   <button type="button" className="button secondary" disabled={plan.tasks.length>=20} onClick={()=>edit({tasks:[...plan.tasks,{title:'',due_date:plan.date}]})}>Add task</button>
   {plan.tasks.some(t=>t.due_date<today) && <p className="auth-feedback">Some deadlines are in the past. Review them before saving.</p>}
   <div className="plan-actions"><button className="button primary">{busy?'Saving…':'Approve and create plan'}</button></div>
  </fieldset>{saving && !busy && <button className="button primary" type="button" onClick={approve}>Retry same save</button>}</form>}
  <p>Keep this page open while drafting. Chat drafts are not saved across refreshes.</p>
  <button type="button" className="button secondary" disabled={busy || saving} onClick={()=>{setMessages([]);setPlan(null);setRequest('');setInput('');setError('');}}>Start over</button>
 </section>;
}
