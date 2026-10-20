import type {ActivityRecord} from './types';
export type AssistantReceipt={request_id:string;user_id:string;record_kind:string;record_id:string;created_at:string;payload:Record<string,unknown>};
export type FeedItem={id:string;category:'DOPIO AI'|'My Team'|'Me'|'System';sentence:string;at:string;href:string;activity?:ActivityRecord};
const text=(v:unknown)=>typeof v==='string'?v:'';
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)?new Date(v+'T12:00:00Z').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}):'no date';
const href=(kind:string,id:string)=>kind==='artist'?`/artists/${id}`:kind==='release'?`/projects/${id}`:kind==='task'?`/?view=Tasks#task-${id}`:kind==='proposal'?`/?view=Approvals#proposal-${id}`:'/?view=Activity';
export function describeActivity(a:ActivityRecord,actor:string){
 const old=a.previous_data??{},now=a.current_data??{};
 const title=text(now.title)||text(now.name)||a.title;
 if(a.action==='updated'){
  if(now.archived_at&&!old.archived_at)return `${actor} archived “${title}”.`;
  if(old.archived_at&&!now.archived_at)return `${actor} restored “${title}”.`;
  if(now.status==='Complete'&&old.status!=='Complete')return `${actor} completed “${title}”.`;
  if(old.status==='Complete'&&now.status!=='Complete')return `${actor} reopened “${title}”.`;
  const key=a.entity_type==='task'?'due_date':a.entity_type==='release'?'release_date':null;
  if(key&&key in old&&key in now&&old[key]!==now[key])return `${actor} moved ${a.entity_type==='task'?'the deadline for':'the release date for'} “${title}” from ${date(old[key])} to ${date(now[key])}.`;
  if(now.status&&now.status!==old.status)return `${actor} changed “${title}” to ${text(now.status)}.`;
  return `${actor} updated ${a.entity_type==='release'?'project':a.entity_type} “${title}”.`;
 }
 if(a.entity_type==='proposal')return a.action==='created'?`${actor} proposed a date change for “${title}”.`:a.action==='conflict'?`The date change for “${title}” was blocked by a conflict.`:`${actor} ${a.action} the date change for “${title}”.`;
 return `${actor} ${a.action==='created'?'created':a.action==='deleted'?'deleted':a.action==='imported'?'imported':a.action} ${a.entity_type==='release'?'project':a.entity_type} “${title}”.`;
}
export function buildActivityFeed(activity:ActivityRecord[],receipts:AssistantReceipt[],user:string):FeedItem[]{
 const used=new Set<string>();
 const result:FeedItem[]=activity.map(a=>{
  const receipt=receipts.find(r=>r.record_id===a.entity_id&&r.record_kind===a.entity_type&&r.user_id===a.actor_id&&r.created_at===a.created_at);
  if(receipt)used.add(receipt.request_id);
  const category=receipt?'DOPIO AI':a.actor_id===user?'Me':a.actor_id?'My Team':'System';
  const actor=receipt?'Dopio, with your approval':category==='Me'?'You':category==='My Team'?'A team member':'An administrator';
  return {id:a.id,category,sentence:describeActivity(a,actor),at:a.created_at,href:href(a.entity_type,a.entity_id),activity:a};
 });
 for(const r of receipts){if(used.has(r.request_id))continue;const kind=text(r.payload.kind);const action=kind.startsWith('create_')?'created':kind==='update_brief'?'updated the artist brief for':kind==='update_project_notes'?'updated project notes for':'updated';result.push({id:`assistant-${r.request_id}`,category:'DOPIO AI',sentence:`Dopio ${action} “${text(r.payload.title)||r.record_kind}” with your approval.`,at:r.created_at,href:href(r.record_kind,r.record_id)});}
 return result.sort((a,b)=>b.at.localeCompare(a.at));
}
