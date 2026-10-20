import {createHash} from 'node:crypto';
export type CalendarItem = {id:string;summary:string;date:string;description:string;google?:{etag:string;summary:string;date:string}|null};
export function eventId(workspace:string,kind:'release'|'task',id:string) {
 return createHash('sha256').update(`${workspace}:${kind}:${id}`).digest('hex');
}
export function projectCalendarItems(workspace:string,artist:string,project:{id:string;title:string;format:string;release_date:string|null},tasks:{id:string;title:string;due_date:string|null}[]) {
 const music=['Single','EP','Album'].includes(project.format);
 const items:CalendarItem[]=project.release_date?[{id:eventId(workspace,'release',project.id),summary:`${artist} — ${project.title}${music?' release':''}`,date:project.release_date,description:`${music?'Release':'Project'} date managed in Dopio. Sync again after changing it in Dopio.`}]:[];
 for(const task of tasks)if(task.due_date)items.push({id:eventId(workspace,'task',task.id),summary:`${artist} — ${task.title}`,date:task.due_date,description:`${project.title} · Task deadline managed in Dopio. Sync again after changing it in Dopio.`});
 return {items,undated:tasks.filter(task=>!task.due_date).length};
}
export function eventBody(item:CalendarItem) {
 const end=new Date(item.date+'T00:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !Number.isFinite(end.getTime()) || end.toISOString().slice(0,10)!==item.date) throw new Error('Invalid calendar date');
 end.setUTCDate(end.getUTCDate()+1);
 return {summary:item.summary,description:item.description,start:{date:item.date},end:{date:end.toISOString().slice(0,10)},transparency:'transparent',reminders:{useDefault:false},extendedProperties:{private:{auraSource:item.id}}};
}
export function snapshot(items:CalendarItem[]) {return createHash('sha256').update(JSON.stringify(items)).digest('hex');}
export class CalendarError extends Error {constructor(public status:number){super(status===401?'Calendar access expired. Reconnect Google Calendar.':status===403?'Calendar access denied. Enable Google Calendar API and grant the requested permissions.':status===412?'An event changed in Google Calendar. Preview again before retrying.':status===429?'Google Calendar is rate limiting requests. Try again later.':'Google Calendar could not complete this operation. Preview again and retry.');}}
export async function calendarRequest(token:string,path:string,method='GET',body?:unknown,etag?:string,fetcher:typeof fetch=fetch) {
 const response=await fetcher('https://www.googleapis.com/calendar/v3/'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(etag?{'If-Match':etag}:{})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new CalendarError(response.status);
 return response.status===204?{}:response.json();
}
export async function upsertEvent(token:string,calendar:string,item:CalendarItem,fetcher:typeof fetch=fetch,expected?:string|null) {
 const base=`calendars/${encodeURIComponent(calendar)}/events`;
 const path=`${base}/${item.id}`;
 const body=eventBody(item);
 function verified(result:{id?:string;start?:{date?:string};end?:{date?:string};summary?:string;description?:string}){
 if(result.id!==item.id||result.start?.date!==body.start.date||result.end?.date!==body.end.date||result.summary!==body.summary||result.description!==body.description)throw new Error('Google did not confirm the reviewed event contents. Preview again to reconcile; the event ID will be reused.');
 }
 let current;
 try {current=await calendarRequest(token,path,'GET',undefined,undefined,fetcher);}
 catch(e) {if(!(e instanceof CalendarError) || e.status!==404)throw e;}
 if(expected!==undefined && (current?.etag??null)!==expected)throw new CalendarError(412);
 if(!current) {
  try {verified(await calendarRequest(token,base+'?sendUpdates=none','POST',{id:item.id,...body},undefined,fetcher));return 'created';}
  catch(e) {if(!(e instanceof CalendarError) || e.status!==409)throw e;}
  current=await calendarRequest(token,path,'GET',undefined,undefined,fetcher);
 }
 if(expected!==undefined && current.etag!==expected)throw new CalendarError(412);
 if(current.extendedProperties?.private?.auraSource!==item.id)throw new Error('Event identity changed. Preview again.');
 if(current.status==='cancelled'){if(!current.etag)throw new Error('Deleted event version is unavailable. Preview again.');verified(await calendarRequest(token,path+'?sendUpdates=none','PATCH',{...body,status:'confirmed'},current.etag,fetcher));return 'updated';}
 if(current.extendedProperties?.private?.auraSource!==item.id || !current.etag) throw new Error('A Dopio event was deleted or its identity changed in Google Calendar. Resolve that event before syncing again.');
 if(current.summary===body.summary && current.description===body.description && current.start?.date===body.start.date && current.end?.date===body.end.date)return 'unchanged';
 verified(await calendarRequest(token,path+'?sendUpdates=none','PATCH',body,current.etag,fetcher));
 return 'updated';
}

export type CalendarRemoval={id:string;summary:string;date:string;etag:string};
export async function removeManagedEvent(token:string,calendar:string,item:CalendarRemoval,fetcher:typeof fetch=fetch){
 try{await calendarRequest(token,'calendars/'+encodeURIComponent(calendar)+'/events/'+encodeURIComponent(item.id)+'?sendUpdates=none','DELETE',undefined,item.etag,fetcher);}
 catch(e){if(!(e instanceof CalendarError)||![404,410].includes(e.status))throw e;}
}

// Both descriptions identify the same managed calendar across the product rename.
export function matchesCalendarMarker(description:unknown,workspace:string,user:string) {
 return description===`Dopio workspace ${workspace}; member ${user}` ||
 description===`AURA workspace ${workspace}; member ${user}`;
}

export async function previewEvent(token:string,calendar:string,item:CalendarItem,fetcher:typeof fetch=fetch):Promise<CalendarItem>{
 try{
 const e=await calendarRequest(token,`calendars/${encodeURIComponent(calendar)}/events/${item.id}`,'GET',undefined,undefined,fetcher);
 if(e.extendedProperties?.private?.auraSource!==item.id||typeof e.etag!=='string')throw new Error('Event identity changed. Resolve it in Google before syncing.');
 return {...item,google:{etag:e.etag,summary:e.summary||'',date:e.start?.date||e.start?.dateTime||'Cancelled'}};
 }catch(e){if(e instanceof CalendarError&&e.status===404)return {...item,google:null};throw e;}
}
