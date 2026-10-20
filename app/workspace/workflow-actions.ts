"use server";
import {loadFollowUps} from './follow-up-actions';
import {requireWorkspace,requireUser} from '@/lib/auth/session';
import {uuidPattern} from '@/lib/workspace/validation';
export async function releaseWorkflowStatus(releaseId:string){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(!uuidPattern.test(releaseId))return {error:'Invalid release.'};
 const snapshot=await loadFollowUps();
 if(snapshot.error)return {error:snapshot.error};
 const tasks=snapshot.rows.filter(t=>t.release_id===releaseId);
 if(!tasks.length)return {error:null,total:0,assigned:0,drafted:0,sent:0,uncertain:0};
 const {data:drafts,error:de}=await supabase.from('task_email_drafts').select('id,task_id').eq('workspace_id',workspace.id).in('task_id',tasks.map(t=>t.id)).limit(1001);
 if(de || !drafts || drafts.length>1000)return {error:'Could not load draft progress. Check database migrations.'};
 const {data:sends,error:se}=drafts.length?await supabase.from('task_email_sends').select('draft_id,status').eq('workspace_id',workspace.id).in('draft_id',drafts.map(d=>d.id)).limit(1001):{data:[],error:null};
 if(se||!sends||sends.length>1000)return {error:'Could not load send progress.'};
 const taskFor=(id:string)=>drafts.find(d=>d.id===id)?.task_id;
 return {error:null,total:tasks.length,assigned:tasks.filter(t=>!t.missingRecipient).length,drafted:new Set(drafts.map(d=>d.task_id)).size,sent:new Set((sends??[]).filter(s=>s.status==='sent').map(s=>taskFor(s.draft_id))).size,uncertain:(sends??[]).filter(s=>s.status!=='sent').length};
}
