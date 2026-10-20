/** Shared policy used by server loaders/actions and their client filters. */
export const DEFAULT_TIME_ZONE = 'America/Chicago';
export function workspaceDay(now:Date=new Date(),timeZone=DEFAULT_TIME_ZONE):string {
 const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(key:string)=>parts.find(p=>p.type===key)!.value;
 return `${part('year')}-${part('month')}-${part('day')}`;
}
type Task={status:string;due_date:string|null;archived_at?:string|null;manager_names?:string[]};
type Project={status:string;format:string;release_date:string|null;archived_at?:string|null};
export const isOpenTask=(t:Task)=>!t.archived_at&&t.status!=='Complete';
export const isCompletedTask=(t:Task)=>!t.archived_at&&t.status==='Complete';
export const isOverdueTask=(t:Task,today:string)=>isOpenTask(t)&&!!t.due_date&&t.due_date<today;
export const isMissingManager=(t:Task)=>isOpenTask(t)&&!(t.manager_names?.length);
export const isCalendarTask=(t:Task)=>isOpenTask(t)&&!!t.due_date;
export const isActiveProject=(r:Project)=>!r.archived_at&&r.status!=='Released';
export const isUpcomingRelease=(r:Project,today:string)=>isActiveProject(r)&&['Single','EP','Album'].includes(r.format)&&!!r.release_date&&r.release_date>=today;
export function withinNextSevenDays(t:Task,today:string){
 const end=new Date(today+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+7);
 return isOpenTask(t)&&!!t.due_date&&t.due_date>=today&&t.due_date<end.toISOString().slice(0,10);
}
export function matchesTaskFilter(t:Task,filter:string,today:string){
 if(t.archived_at)return false;
 return filter==='All'||(filter==='Overdue'?isOverdueTask(t,today):filter==='Missing managers'?isMissingManager(t):t.status===filter);
}
export function activeRecords<A extends {record_id:string;archived_at?:string|null},R extends {id:string;artist_id:string;archived_at?:string|null},T extends {artist_id:string|null;release_id:string|null;archived_at?:string|null}>(artists:A[],releases:R[],tasks:T[]){
 const aa=artists.filter(a=>!a.archived_at);const ids=new Set(aa.map(a=>a.record_id));
 const rr=releases.filter(r=>!r.archived_at&&ids.has(r.artist_id));const projects=new Set(rr.map(r=>r.id));
 return {artists:aa,releases:rr,tasks:tasks.filter(t=>!t.archived_at&&(!t.artist_id||ids.has(t.artist_id))&&(!t.release_id||projects.has(t.release_id)))};
}
