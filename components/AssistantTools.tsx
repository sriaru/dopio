'use client';
import {taskStatusLabel} from '@/lib/workspace/task-status';
import {useState} from 'react';
import type {ReviewedTool} from '@/lib/ai/assistant-tools';
import type {WorkspaceData} from '@/lib/workspace/types';
import {executeAssistantTask,executeAssistantRecord} from '@/app/workspace/assistant-history-actions';
import ReleaseRevisionPlanner from './ReleaseRevisionPlanner';
import GoogleCalendarSync from './GoogleCalendarSync';
export default function AssistantTools({tools,workspace,data,outcomes,onResult}:{tools:ReviewedTool[];workspace:string;data:WorkspaceData;outcomes:Record<string,string>;onResult:(id:string,result:string)=>Promise<void>}){
 const [busy,setBusy]=useState(''),[opened,setOpened]=useState(''),[error,setError]=useState('');
 return <div className="assistant-tools">{tools.map((tool,index)=><section className="chat-proposal" key={tool.request}>
 <p className="eyebrow">STEP {index+1} · {outcomes[tool.request]&&!outcomes[tool.request].startsWith('Failed:')?'RESULT':'REVIEW REQUIRED'}</p><h3>{tool.title||String(tool.before?.title||tool.kind.replaceAll('_',' '))}</h3><p>{tool.request_text}</p>
 {outcomes[tool.request]&&!outcomes[tool.request].startsWith('Failed:')?<p role="status">{outcomes[tool.request]}</p>:<>
 {(tool.kind==='create_task'||tool.kind==='update_task')&&<dl className="assistant-diff"><dt>Title</dt><dd>{String(tool.before?.title??'New task')} → {tool.title}</dd><dt>Deadline</dt><dd>{String(tool.before?.due_date??'Not set')} → {tool.date??'Not set'}</dd><dt>Status</dt><dd>{taskStatusLabel(String(tool.before?.status??'New'))} → {taskStatusLabel(tool.status??'Pending')}</dd><dt>Notes</dt><dd>{String(tool.before?.notes??'None')} → {tool.notes||'None'}</dd><dt>Artist / project</dt><dd>{data.artists.find(a=>a.record_id===tool.artist_id)?.name??tool.artist_id} / {data.releases.find(r=>r.id===tool.release_id)?.title??'No project'}</dd></dl>}
 {outcomes[tool.request]?.startsWith('Failed:')&&<p role="alert">{outcomes[tool.request]}</p>}
 {['create_artist','update_artist','update_brief','update_project_notes'].includes(tool.kind)&&<dl className="assistant-diff"><dt>Name</dt><dd>{String(tool.before?.name??tool.before?.title??'New')} → {tool.title}</dd>{tool.kind==='update_artist'&&<><dt>Status</dt><dd>{String(tool.before?.status)} → {tool.status}</dd></>}{['update_brief','update_project_notes'].includes(tool.kind)&&<><dt>Notes</dt><dd>{String(tool.before?.release_context??tool.before?.notes??'None')} → {tool.notes}</dd></>}</dl>}
 {tool.conflicts.map(c=><p key={c} className="auth-feedback error">{c}</p>)}
 <button className="button primary" disabled={!!busy||!!tool.conflicts.length} onClick={async()=>{
  if(tool.kind==='revise_release'||tool.kind==='calendar_sync'){setOpened(opened===tool.request?'':tool.request);return;}
  setBusy(tool.request);setError('');try{const r=await (tool.kind==='create_task'||tool.kind==='update_task'?executeAssistantTask:executeAssistantRecord)(workspace,tool.request,tool);if(r.error){setError(r.error);await onResult(tool.request,'Failed: '+r.error);}else await onResult(tool.request,`Saved ${tool.kind.replaceAll('_',' ')}. Record ${r.id}. No email sent or Google Calendar changed.`);}catch{setError('Result not confirmed. Retry this same card to reconcile safely.');}finally{setBusy('');}
 }}>{busy===tool.request?'Saving…':tool.kind==='revise_release'?'Review coordinated changes':tool.kind==='calendar_sync'?'Preview exact Google events':'Approve exact changes'}</button>
 <button className="button secondary" disabled={!!busy} onClick={()=>onResult(tool.request,'Dismissed by you. No changes executed.')}>Dismiss</button>
 {opened===tool.request&&tool.kind==='revise_release'&&<ReleaseRevisionPlanner data={data} initialRelease={tool.target_id!} initialRequest={tool.request_text} onSaved={async id=>{await onResult(tool.request,`Release and reviewed task changes saved: ${id}. No email sent or Google Calendar changed.`);setOpened('');}}/>}
 {opened===tool.request&&tool.kind==='calendar_sync'&&<GoogleCalendarSync data={data} releaseId={tool.target_id!} onSynced={()=>{void onResult(tool.request,'Reviewed events confirmed by Google; see Calendar for the persisted sync receipt.');}}/>}
 </>}
 </section>)}{error&&<p className="auth-feedback error" role="alert">{error}</p>}</div>;
}
