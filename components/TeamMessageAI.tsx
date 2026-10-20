'use client';
import {useState} from 'react';
import {teamMessageInsight,reviewTeamMessage} from '@/app/workspace/team-ai-actions';
import type {TeamInsight,TeamTarget,TeamSource} from '@/lib/ai/team-messages';
import styles from './ArtistMessages.module.css';
export default function TeamMessageAI({workspace,artist}:{workspace:string;artist:string}){
 const [result,setResult]=useState<TeamInsight|null>(null),[targets,setTargets]=useState<TeamTarget[]>([]),[sources,setSources]=useState<TeamSource[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState(-1),[target,setTarget]=useState(''),[date,setDate]=useState(''),[saved,setSaved]=useState('');
 async function analyze(mode:'summary'|'actions'){if(busy)return;setBusy(true);setError('');setResult(null);setSaved('');setSelected(-1);try{const r=await teamMessageInsight(workspace,artist,mode);if(r.error)setError(r.error);else if(r.result){setResult(r.result);setTargets(r.targets);setSources(r.sources);}}catch{setError('Could not reach AI. Try again.');}finally{setBusy(false);}}
 const action=result?.actions[selected],record=targets.find(t=>t.id===target);
 const conflicts=record?.kind==='release'?targets.filter(t=>t.kind==='task'&&t.projectId===record.id&&t.date&&date&&t.date>date):[];
 const parent=record?.kind==='task'?targets.find(t=>t.id===record.projectId):null;
 return <div className={styles.aiTools}><div className="plan-actions"><button className="button secondary" disabled={busy} onClick={()=>void analyze('summary')}>Summarize unread</button><button className="button secondary" disabled={busy} onClick={()=>void analyze('actions')}>Find action items</button></div>
 <small>Uses unread messages for summaries or the latest 100 messages for action items, only when requested.</small>
 {busy&&<p role="status">Analyzing messages…</p>}{error&&<p role="alert">{error}</p>}
 {result&&<aside className={styles.aiPanel}><button className="text-link" onClick={()=>{setResult(null);setSelected(-1);}}>Dismiss AI results</button><h3>AI-generated · Check the sources</h3>
 {!result.points.length&&!result.actions.length&&<p>No supported decisions or date-change requests found.</p>}
 {result.points.map((p,i)=><div key={i}><p>{p.text}</p><details><summary>Source message #{p.source_id}</summary><blockquote>{p.quote}</blockquote><small>{sources.find(s=>s.id===p.source_id)?.actor_name}</small></details></div>)}
 {result.actions.map((a,i)=><div key={i} className={styles.event}><strong>Suggested action</strong><p>{a.text}</p><blockquote>{a.quote}</blockquote><small>Message #{a.source_id}</small><p>{a.clarification||'Select the intended saved record and confirm the full date.'}</p><button className="button secondary" onClick={()=>{setSelected(i);setTarget('');setDate(a.date??'');setSaved('');}}>Review change</button> <button className="text-link" onClick={()=>{setResult({...result,actions:result.actions.filter((_,n)=>n!==i)});setSelected(-1);}}>Dismiss</button></div>)}
 {action&&<form onSubmit={async e=>{e.preventDefault();if(!record||busy)return;setBusy(true);setError('');try{const r=await reviewTeamMessage(workspace,artist,action.source_id,record.kind,record.id,record.version,date,action.quote);if(r.error)setError(r.error);else setSaved(r.id!);}catch{setError('Could not confirm the saved review. Retry the same selection.');}finally{setBusy(false);}}}>
 <h3>Review the exact change</h3><label>Saved task or project<select required value={target} onChange={e=>{setTarget(e.target.value);setSaved('');}}><option value="">Choose the intended record</option>{targets.map(t=><option key={t.id} value={t.id}>{t.kind==='task'?'Task':'Project'}: {t.title}{t.project?' — '+t.project:''}</option>)}</select></label>
 <p>Current date: {record?.date??'No date'}</p><label>Confirm proposed date (including year)<input required type="date" min="1900-01-01" max="2199-12-31" value={date} onChange={e=>{setDate(e.target.value);setSaved('');}}/></label>
 <p>Relative dates are suggestions based on the message’s timestamp. Confirm the intended day. Related task deadlines stay unchanged; conflicting schedules will block approval.</p>
 {conflicts.length>0&&<p role="alert">Conflicting task deadlines: {conflicts.map(t=>`${t.title} (${t.date})`).join(', ')}. Approval will require resolving the schedule.</p>}{parent?.date&&date>parent.date&&<p role="alert">This date is after the project date ({parent.date}). Music-release approvals will be blocked until the schedule is resolved.</p>}<blockquote>{action.quote}</blockquote>
 {saved?<p role="status">Pending review saved. <a href={`/?view=Approvals#proposal-${saved}`}>Open Approvals to approve or reject →</a></p>:<button className="button primary" disabled={busy||!record||!date}>Save pending review</button>}
 </form>}
 </aside>}
 </div>;
}
