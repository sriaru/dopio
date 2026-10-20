import {isOpenTask,isOverdueTask,isMissingManager} from './rules';
export type FollowUpTask = {
  manager_names?: string[]; archived_at?:string|null;
  id: string; title: string; due_date: string | null; status: string;
  artist_id: string | null; release_id: string | null; owner_contact_id: string | null;
};
export type FollowUpDraft = { id: string; task_id: string; updated_at: string };
export type FollowUpSend = { draft_id: string; status: string; created_at: string };
export type FollowUpRow = FollowUpTask & {
  owner: string; email: string; state: 'check_send' | 'missing_owner' | 'missing_email' | 'draft' | 'sent' | 'ready';
  missingRecipient:boolean; missingManager:boolean; actionableOverdue:boolean;
  draftId: string | null; lastSentAt: string | null; overdue: boolean;
};
/** Sent records prove a send was recorded, never that a reply or delivery occurred. */
export function buildFollowUps(tasks: FollowUpTask[], contacts: {id:string;name:string;email:string}[], drafts: FollowUpDraft[], sends: FollowUpSend[], today: string): FollowUpRow[] {
  return tasks.filter(isOpenTask).map(t=>{
    const owner=contacts.find(c=>c.id===t.owner_contact_id);
    const history=drafts.filter(d=>d.task_id===t.id).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||a.id.localeCompare(b.id));
    const ids=new Set(history.map(d=>d.id));
    const attempts=sends.filter(s=>ids.has(s.draft_id)).sort((a,b)=>b.created_at.localeCompare(a.created_at));
    const uncertain=attempts.find(s=>s.status!=='sent');
    const lastSent=attempts.find(s=>s.status==='sent');
    const unsent=history.find(d=>!attempts.some(s=>s.draft_id===d.id));
    const state:FollowUpRow['state']=uncertain?'check_send':!owner?'missing_owner':!owner.email.trim()?'missing_email':unsent?'draft':lastSent?'sent':'ready';
    const missingRecipient=!owner||!owner.email.trim();
    const missingManager=isMissingManager(t);
    return {...t,missingRecipient,missingManager,actionableOverdue:isOverdueTask(t,today)&&!missingManager&&!missingRecipient&&!uncertain,owner:owner?.name??'Not selected',email:owner?.email??'',state,
      draftId:uncertain?.draft_id??unsent?.id??lastSent?.draft_id??null,lastSentAt:lastSent?.created_at??null,
      overdue:isOverdueTask(t,today)};
  }).sort((a,b)=>Number(b.state==='check_send')-Number(a.state==='check_send')||Number(b.overdue)-Number(a.overdue)||(a.due_date??'9999').localeCompare(b.due_date??'9999')||a.title.localeCompare(b.title));
}
