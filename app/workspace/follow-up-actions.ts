"use server";
import {loadWorkspace} from '@/lib/workspace/data';
import {isOpenTask} from '@/lib/workspace/rules';
import {requireWorkspace,requireUser} from '@/lib/auth/session';
import {buildFollowUps,type FollowUpRow} from '@/lib/workspace/follow-ups';
export async function loadFollowUps():Promise<{error:string|null;rows:FollowUpRow[]}> {
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 const fail={error:'Could not load complete follow-up history. Refresh before preparing another message.',rows:[]};
 const snapshot=await loadWorkspace(workspace.id);
 const [tasks,contacts,drafts,sends]=await Promise.all([
  supabase.from('tasks').select('id,title,due_date,status,artist_id,release_id,owner_contact_id').eq('workspace_id',workspace.id).is('archived_at',null).neq('status','Complete').limit(1001),
  supabase.from('workspace_contacts').select('id,name,email').eq('workspace_id',workspace.id).limit(1001),
  supabase.from('task_email_drafts').select('id,task_id,updated_at').eq('workspace_id',workspace.id).limit(1001),
  supabase.from('task_email_sends').select('draft_id,status,created_at').eq('workspace_id',workspace.id).limit(1001),
 ]);
 // Do not display an apparently safe queue when a query fails or is truncated.
 if([tasks,contacts,drafts,sends].some(r=>r.error||!r.data||r.data.length>1000))return fail;
 const permitted=new Map(snapshot.tasks.filter(isOpenTask).map(t=>[t.id,t]));
 const active=tasks.data!.filter(t=>permitted.has(t.id)).map(t=>({...t,manager_names:permitted.get(t.id)!.manager_names}));
 return {error:null,rows:buildFollowUps(active,contacts.data!,drafts.data!,sends.data!,snapshot.today!)};
}
