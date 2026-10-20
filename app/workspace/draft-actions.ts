"use server";
import {requireWorkspace,requireUser} from '@/lib/auth/session';
import {signMessage} from '@/lib/ai/signature';
import {uuidPattern} from '@/lib/workspace/validation';
export type TaskDraft={id:string;task_id:string;recipient:string;subject:string;body:string;version:number;task_snapshot?:Record<string,unknown>;updated_at?:string;send_status?:string};
export async function listTaskDrafts(selectedId?:string,taskId?:string){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if((selectedId&&!uuidPattern.test(selectedId))||(taskId&&!uuidPattern.test(taskId)))return {drafts:[] as TaskDraft[],error:'Choose a valid saved draft.'};
 let query=supabase.from('task_email_drafts').select('id,task_id,recipient,subject,body,version,task_snapshot,updated_at').eq('workspace_id',workspace.id).order('updated_at',{ascending:false}).limit(100);
 if(selectedId)query=query.eq('id',selectedId);
 if(taskId)query=query.eq('task_id',taskId);
 const {data,error}=await query;
 if(error)return {drafts:[] as TaskDraft[],error:'Could not load saved drafts. Refresh and try again.'};
 if(!data?.length)return {drafts:[] as TaskDraft[],error:selectedId?'This saved draft is no longer available.':null};
 const {data:sends,error:sendError}=await supabase.from('task_email_sends').select('draft_id,status').eq('workspace_id',workspace.id).in('draft_id',data.map(d=>d.id));
 if(sendError)return {drafts:[] as TaskDraft[],error:'Could not verify send history. Drafts are unavailable until this check succeeds.'};
 return {drafts:data.map(d=>({...d,send_status:sends?.find(s=>s.draft_id===d.id)?.status})) as TaskDraft[],error:null};
}
export async function prepareTaskDraft(taskId:string){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(!uuidPattern.test(taskId))return {error:'Choose a task.'};
 const {data:t,error}=await supabase.rpc('review_task_email_snapshot',{p_workspace:workspace.id,p_task:taskId});
 if(error||!t)return {error:'Task could not be loaded. Apply migration 020 first.'};
 if(t.status==='Complete'||t.archived||t.artist_archived||t.release_archived)return {error:'Choose an active, open task.'};
 if(!t.owner_email)return {error:'Choose a follow-up recipient with an email address first.'};
 const c={name:t.owner_name,email:t.owner_email},a=t.artist?{name:t.artist}:null,r=t.release?{title:t.release}:null;
 const subject=`Task update: ${t.title}`.replace(/[\r\n]+/g,' ').slice(0,200);
 const body=`Hi ${c.name},\n\nHere are the current details for your task:\n\nTask: ${t.title}\n${a?`Artist: ${a.name}\n`:''}${r?`Release: ${r.title}\n`:''}Deadline: ${t.date || 'Not set'}\nStatus: ${t.status}\n\nPlease let me know if you have any questions or need to adjust the timeline.\n\nThanks!`;
 return {error:null,draft:{id:crypto.randomUUID(),task_id:taskId,task_snapshot:t,recipient:c.email,subject,body,version:0} as TaskDraft};
}
export async function saveTaskDraft(d:TaskDraft){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(!d || !uuidPattern.test(d.id) || !uuidPattern.test(d.task_id) || !Number.isInteger(d.version) || typeof d.recipient!=='string' || d.recipient.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.recipient) || typeof d.subject!=='string' || !d.subject.trim() || d.subject.length>200 || /[\r\n]/.test(d.subject) || typeof d.body!=='string' || !d.body.trim() || d.body.length>20000)return {error:'Check the recipient, subject and message.'};
 const {data,error}=await supabase.rpc('save_task_email_draft_v2',{p_workspace:workspace.id,p_id:d.id,p_task:d.task_id,p_version:d.version,p_recipient:d.recipient,p_subject:d.subject,p_body:d.body,p_snapshot:d.task_snapshot??null});
 return {error:error?.code==='40001'?'The task or draft changed. Prepare a fresh draft before saving.':error?'Draft could not be saved. Check migration 013 and try again.':null,version:data as number|undefined};
}

export async function prepareAiTaskMessage(taskId:string,emailIds:string[],workingId?:string){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(!uuidPattern.test(taskId)||!Array.isArray(emailIds)||emailIds.length>5||emailIds.some(id=>!uuidPattern.test(id))||(workingId&&!uuidPattern.test(workingId)))return {error:'Choose one task and up to five imported emails.'};
 const {data:senderName,error:senderError}=await supabase.rpc('workspace_sender_name',{p_workspace:workspace.id});
 if(senderError||typeof senderName!=='string'||!senderName.trim())return {error:'Set the workspace owner’s profile name and apply migration 026 before preparing messages.'};
 const key=process.env.OPENAI_API_KEY;if(!key)return {error:'AI is not configured. Ask your workspace administrator to enable it.'};
 const {data:t,error}=await supabase.rpc('review_task_email_snapshot',{p_workspace:workspace.id,p_task:taskId});
 if(error||!t)return {error:'Could not load the current task. Refresh and try again.'};
 if(t.status==='Complete'||t.archived||t.artist_archived||t.release_archived)return {error:'Choose an active, open task.'};
 if(!t.owner_email)return {error:'Choose a follow-up recipient with an email address first.'};
 const {data:history,error:he}=await supabase.from('task_email_drafts').select('id,task_id,recipient,subject,body,version,task_snapshot,updated_at').eq('workspace_id',workspace.id).eq('task_id',taskId).order('updated_at',{ascending:false}).limit(1000);
 if(he||!history||history.length>=1000)return {error:'Could not verify complete message history. No message was prepared.'};
 const {data:sends,error:se}=history.length?await supabase.from('task_email_sends').select('draft_id,status').eq('workspace_id',workspace.id).in('draft_id',history.map(d=>d.id)):{data:[],error:null};
 if(se||!sends)return {error:'Could not verify send history. Try again later.'};
 if(sends.some(s=>s.status!=='sent'))return {error:'Check the uncertain send for this task in Gmail before preparing another message.'};
 const reusable=history.find(d=>!sends.some(s=>s.draft_id===d.id)&&(!workingId||d.id===workingId));
 if(workingId&&!reusable)return {error:'This draft changed or was sent. Reload before preparing a message.'};
 const ids=[...new Set(emailIds)];
 const {data:emails,error:ee}=ids.length?await supabase.from('inbox_messages').select('id,subject,body,sender,created_at').eq('workspace_id',workspace.id).in('id',ids):{data:[],error:null};
 if(ee||!emails||emails.length!==ids.length)return {error:'A selected email is unavailable. Review your sources.'};
 const {data:allowed,error:limit}=await supabase.rpc('reserve_email_analysis',{p_workspace:workspace.id});
 if(limit||!allowed)return {error:'AI access or allowance is unavailable. Check your workspace role and AI usage in Company settings.'};
 try{
  const {generateFollowUp}=await import('@/lib/ai/follow-up-message');
  const sources=emails.map(e=>({...e,subject:e.subject.slice(0,300),body:e.body.slice(0,6000)}));
  const previous=history.filter(d=>sends.some(s=>s.draft_id===d.id&&s.status==='sent')).slice(0,3).map(d=>({subject:d.subject,body:d.body.slice(0,3000)}));
  const message=await generateFollowUp(key,process.env.OPENAI_EMAIL_MODEL||'gpt-4o-mini',{title:t.title,artist:t.artist,project:t.release,date:t.date,status:t.status,owner_name:t.owner_name},sources,previous);
  return {error:null,draft:{id:reusable?.id??crypto.randomUUID(),task_id:taskId,task_snapshot:t,recipient:t.owner_email,subject:message.subject,body:signMessage(message.body,senderName),version:reusable?.version??0} as TaskDraft,sources:sources.filter(s=>message.source_ids.includes(s.id)).map(s=>({id:s.id,subject:s.subject}))};
 }catch{return {error:'AI could not prepare a complete message. Your existing draft is unchanged. Try again or edit it manually.'};}
}
