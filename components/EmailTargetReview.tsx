"use client";
import {useRef,useState} from 'react';
import {selectEmailTarget} from '@/app/workspace/email-actions';
import type {WorkspaceData} from '@/lib/workspace/types';
import type {InboxMessage} from '@/lib/workspace/email-types';
export default function EmailTargetReview({data,message,onData}:{data:WorkspaceData;message:InboxMessage;onData:(d:WorkspaceData)=>void}){
 const [kind,setKind]=useState('task'),[target,setTarget]=useState(''),[date,setDate]=useState(''),[quote,setQuote]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);const guard=useRef(false);
 const records=kind==='task'?data.tasks.filter(t=>t.status!=='Complete'):data.releases;
 async function prepare(){if(guard.current)return;guard.current=true;setBusy(true);setError('');try{const r=await selectEmailTarget(message.id,kind,target,date,quote);if(r.error)setError(r.error);else if(r.data)onData(r.data);}catch{setError('Could not confirm the saved review. Refresh before retrying.');}finally{guard.current=false;setBusy(false);}}
 return <details><summary>Select the intended task or release</summary>
 <p>If the email is ambiguous, choose the actual saved record. This creates a pending review; it does not change any dates.</p>
 <label>Change type<select value={kind} onChange={e=>{setKind(e.target.value);setTarget('');}}><option value="task">Task deadline</option><option value="release">Release date</option></select></label>
 <label>Saved record<select value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choose a record</option>{records.map(r=><option key={r.id} value={r.id}>{data.artists.find(a=>a.record_id===r.artist_id)?.name} — {'release_id' in r?data.releases.find(p=>p.id===r.release_id)?.title+' — ':''}{r.title} · {r.id.slice(0,8)}</option>)}</select></label>
 <label>Proposed date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
 <label>Exact quote from this email, including the full date<textarea value={quote} maxLength={2000} onChange={e=>setQuote(e.target.value)}/></label>
 {error&&<p role="alert" className="auth-feedback error">{error}</p>}
 <button className="button secondary" disabled={busy||!target||!date||!quote.trim()} onClick={()=>void prepare()}>{busy?'Saving review…':'Prepare review'}</button>
 </details>;
}
