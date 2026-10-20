"use server";
import {receiptClient} from '@/lib/gmail/receipts';
import {isCalendarTask,isOpenTask} from '@/lib/workspace/rules';
import {matchesCalendarMarker} from '@/lib/calendar/events';
import {cookies,headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {randomUUID} from 'node:crypto';
import {requireWorkspace,requireUser} from '@/lib/auth/session';
import {calendarConfig,CALENDAR_SCOPES} from '@/lib/calendar/config';
import {authorizationURL,newPendingOAuth,seal,unseal} from '@/lib/gmail/security';
import {tokenRequest} from '@/lib/gmail/api';
import {calendarRequest,previewEvent,eventId,projectCalendarItems,snapshot,upsertEvent,removeManagedEvent,type CalendarRemoval,type CalendarItem,CalendarError} from '@/lib/calendar/events';
import {loadWorkspace} from '@/lib/workspace/data';
import {uuidPattern} from '@/lib/workspace/validation';
const context=(w:string,u:string,id:string,email:string)=>`calendar:${w}:${u}:${id}:${email}`;
function safeError(e:unknown){return e instanceof CalendarError ? e.message : e instanceof Error && e.name==='Error' ? e.message : 'Calendar could not be reached. Preview again and retry.';}
export async function calendarStatus(){
 const {workspace,user}=await requireWorkspace();const {supabase}=await requireUser();
 let configured=true;try{calendarConfig();}catch{configured=false;}
 const {data,error}=await supabase.from('calendar_connections').select('email,connection_id,calendar_id,encrypted_refresh_token').eq('workspace_id',workspace.id).eq('user_id',user.id).maybeSingle();
 const {data:lastSync}=await supabase.from('google_calendar_runs').select('status,confirmed_events,confirmed_removals,created_at').eq('workspace_id',workspace.id).eq('actor_id',user.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
 return {lastSync:lastSync as {status:string;confirmed_events:number;confirmed_removals:number;created_at:string}|null,configured,email:data?.email??null,connectionId:data?.encrypted_refresh_token?data.connection_id:null,calendarId:data?.calendar_id??null,error:error?'Run migration 011 in Supabase first.':!configured?'Complete Calendar setup (see instructions below).':null};
}
export async function connectCalendar(setup = false){
 const {workspace,user}=await requireWorkspace();const {supabase}=await requireUser();let target;
 try{
 const c=calendarConfig();if((await headers()).get('origin')!==c.origin)return {error:`Open Dopio at ${c.origin} to connect Calendar.`};
 const {error}=await supabase.from('calendar_connections').select('connection_id').eq('workspace_id',workspace.id).eq('user_id',user.id).limit(1);
 if(error)return {error:'Run migration 011 before connecting.'};
 const p=newPendingOAuth(user.id,workspace.id);if(setup===true)p.returnTo="/get-started";
 (await cookies()).set('aura-calendar-oauth',seal(JSON.stringify(p),'calendar-oauth',c.key),{httpOnly:true,secure:c.origin.startsWith('https:'),sameSite:'lax',path:'/calendar',maxAge:600});
 const url=new URL(authorizationURL(p,c.clientId,c.redirectUri));url.searchParams.set('scope',CALENDAR_SCOPES.join(' '));target=url.toString();
 }catch{return {error:'Calendar setup is incomplete. Check the setup instructions.'};}
 redirect(target);
}
async function connection(expected:string){
 const {workspace,user}=await requireWorkspace();const {supabase}=await requireUser();
 const {data,error}=await supabase.from('calendar_connections').select('*').eq('workspace_id',workspace.id).eq('user_id',user.id).eq('connection_id',expected).maybeSingle();
 if(error || !data?.encrypted_refresh_token)throw new Error('Calendar connection changed. Reload its status and reconnect if needed.');
 const config=calendarConfig();
 return {workspace,user,supabase,row:data,config};
}
async function access(c:Awaited<ReturnType<typeof connection>>){
 try{
 const refresh=unseal(c.row.encrypted_refresh_token,context(c.workspace.id,c.user.id,c.row.connection_id,c.row.email),c.config.key);
 return (await tokenRequest({client_id:c.config.clientId,client_secret:c.config.clientSecret,grant_type:'refresh_token',refresh_token:refresh})).access_token;
 }catch{throw new Error('Calendar authorization expired or could not be read. Reconnect Google Calendar.');}
}
async function itemsForRelease(releaseId:string){
 const {workspace}=await requireWorkspace();
 if(releaseId==='cleanup')return {items:[] as CalendarItem[],undated:0};
 if(!uuidPattern.test(releaseId))throw new Error('Choose a release.');
 const data=await loadWorkspace(workspace.id);
 const r=data.releases.find(r=>r.id===releaseId);
 const a=data.artists.find(a=>a.record_id===r?.artist_id);
 if(!r||!a)throw new Error('Choose an active project.');
 const tasks=data.tasks.filter(t=>t.release_id===r.id&&isOpenTask(t)).sort((a,b)=>a.id.localeCompare(b.id));
 if(tasks.length>500)throw new Error('This first Calendar version supports up to 500 open tasks per release.');
 return projectCalendarItems(workspace.id,a.name,r,tasks);
}

async function calendarRemovals(c:Awaited<ReturnType<typeof connection>>):Promise<CalendarRemoval[]>{
 if(!c.row.calendar_id)return [];
 // Only remove events for records still visible to this user. Absence under
 // RLS is not proof of deletion and must never expose a former assignment.
 const [{data:tasks,error:te},{data:releases,error:re}]=await Promise.all([
 c.supabase.from('tasks').select('id,due_date,status,archived_at').eq('workspace_id',c.workspace.id),
 c.supabase.from('releases').select('id,release_date,archived_at').eq('workspace_id',c.workspace.id)]);
 if(te||re)throw new Error('Could not verify cleanup permissions. Nothing removed.');
 const obsolete=new Set([
 ...(tasks??[]).filter(t=>!isCalendarTask(t)).map(t=>eventId(c.workspace.id,'task',t.id)),
 ...(releases??[]).filter(r=>r.archived_at||!r.release_date).map(r=>eventId(c.workspace.id,'release',r.id))]);
 const token=await access(c);const removals:CalendarRemoval[]=[];let page:string|undefined;let pages=0;
 do{
 const result=await calendarRequest(token,'calendars/'+encodeURIComponent(c.row.calendar_id)+'/events?maxResults=250'+(page?'&pageToken='+encodeURIComponent(page):''));
 for(const e of result.items??[])if(e.status!=='cancelled'&&e.extendedProperties?.private?.auraSource===e.id&&obsolete.has(e.id)&&typeof e.etag==='string'){
 removals.push({id:e.id,summary:e.summary||'Dopio event',date:e.start?.date||'',etag:e.etag});
 }
 page=result.nextPageToken;if(++pages>=20&&page)throw new Error('Too many Calendar events for one review. Contact support before cleanup.');
 }while(page);
 if(removals.length>100)throw new Error('More than 100 obsolete events. Review cleanup in smaller batches with support.');
 return removals;
}
export async function previewCalendar(expected:string,releaseId:string){
 await requireWorkspace();try{
 const c=await connection(expected);const {items,undated}=await itemsForRelease(releaseId);
 const removals=await calendarRemovals(c);
 const token=await access(c);const reviewed:CalendarItem[]=[];
 for(const item of items)reviewed.push(c.row.calendar_id?await previewEvent(token,c.row.calendar_id,item):{...item,google:null});
 const ticket=seal(JSON.stringify({releaseId,removals,reviewed,hash:snapshot(items),expires:Date.now()+900000}),`calendar-preview:${c.workspace.id}:${c.user.id}:${expected}`,c.config.key);
 return {error:null,items:reviewed,removals,undated,ticket};
 }catch(e){return {error:safeError(e),items:[] as CalendarItem[],removals:[] as CalendarRemoval[],undated:0,ticket:''};}
}
export async function syncCalendar(expected:string,ticket:string){
 await requireWorkspace();let c:Awaited<ReturnType<typeof connection>>|undefined;const lease=randomUUID();let claimed=false;let completed=0;let removed=0;let recorded=false;
 async function record(status:string){
 const result=await receiptClient().rpc('record_calendar_run',{p_id:lease,p_workspace:c!.workspace.id,p_actor:c!.user.id,p_connection:expected,p_status:status,p_events:completed,p_removals:removed});
 if(result.error)throw new Error('Could not persist the Google sync result. Check Google and preview again; stable event IDs prevent duplicates.');
 }
 try{
 c=await connection(expected);
 const {data:role}=await c.supabase.rpc('workspace_role',{p_workspace:c.workspace.id});
 if(!['owner','manager'].includes(role))throw new Error('A workspace owner or manager must approve Calendar changes.');
 if(typeof ticket!=='string' || ticket.length>100000)throw new Error('Preview expired. Preview again.');
 let p:{releaseId:string;hash:string;expires:number;removals:CalendarRemoval[];reviewed:CalendarItem[]};
 try{p=JSON.parse(unseal(ticket,`calendar-preview:${c.workspace.id}:${c.user.id}:${expected}`,c.config.key));}catch{throw new Error('Preview is invalid. Preview again.');}
 if(!Number.isFinite(p.expires) || p.expires<Date.now())throw new Error('Preview expired. Preview again.');
 const {data:locked,error:lockError}=await c.supabase.rpc('claim_calendar_sync',{p_workspace:c.workspace.id,p_connection:expected,p_lease:lease});
 if(lockError || !locked)throw new Error('A Calendar operation is already running. Wait for it to finish before retrying.');claimed=true;
 await record('running');recorded=true;
 const {items}=await itemsForRelease(p.releaseId);
 if(snapshot(items)!==p.hash)throw new Error('Release or task details changed after preview. Preview again before approving.');
 const currentlyObsolete=await calendarRemovals(c);
 if((p.removals||[]).some(r=>!currentlyObsolete.some(e=>e.id===r.id&&e.etag===r.etag)))throw new Error('Calendar cleanup changed. Preview again.');
 const token=await access(c);
 if(!Array.isArray(p.reviewed)||p.reviewed.length!==items.length)throw new Error('Preview again before syncing.');
 // Check every Google baseline before the first mutation; If-Match also covers
 // changes between this preflight and each individual write.
 if(c.row.calendar_id)for(const reviewed of p.reviewed){
 const current=await previewEvent(token,c.row.calendar_id,reviewed);
 if((current.google?.etag??null)!==(reviewed.google?.etag??null))throw new CalendarError(412);
 }
 const marker=`Dopio workspace ${c.workspace.id}; member ${c.user.id}`;
 let calendar=c.row.calendar_id as string|null;
 if(!calendar && p.releaseId==='cleanup'){await record('confirmed');return {error:null,message:'No Dopio calendar exists. Nothing to remove.'};}
 if(!calendar){
  // Recover an acknowledged or uncertain creation before ever creating another calendar.
  let page:string|undefined;const matches:string[]=[];let pages=0;
  do{
   const list=await calendarRequest(token,'users/me/calendarList?maxResults=250'+(page?'&pageToken='+encodeURIComponent(page):''));
   for(const item of list.items??[])if(matchesCalendarMarker(item.description,c.workspace.id,c.user.id) && item.accessRole==='owner')matches.push(item.id);
   page=list.nextPageToken;pages++;
   if(page && pages>=10)throw new Error('Too many calendars to safely locate the Dopio calendar.');
  }while(page);
  if(matches.length>1)throw new Error('Multiple Dopio calendars were found. Resolve duplicate calendars in Google before syncing.');
  calendar=matches[0]??null;
  if(!calendar){
   if(c.row.creation_started)throw new Error('A prior calendar creation could not be confirmed. Check Google Calendar, wait a minute, then retry. Dopio will not create a duplicate.');
   const {data:marked,error:markError}=await c.supabase.from('calendar_connections').update({creation_started:true}).eq('workspace_id',c.workspace.id).eq('user_id',c.user.id).eq('connection_id',expected).eq('lease_id',lease).select('connection_id');
   if(markError || !marked?.length)throw new Error('Connection changed before calendar creation.');
   let created;
   try {created=await calendarRequest(token,'calendars','POST',{summary:`Dopio — ${c.workspace.name}`,description:marker,timeZone:(await loadWorkspace(c.workspace.id)).timeZone});}
   catch(e){
    // A definite client rejection did not create a calendar. An uncertain timeout
    // or server failure keeps the marker, so recovery cannot create duplicates.
    if(e instanceof CalendarError && [400,401,403,429].includes(e.status))
      await c.supabase.from('calendar_connections').update({creation_started:false}).eq('workspace_id',c.workspace.id).eq('user_id',c.user.id).eq('connection_id',expected).eq('lease_id',lease);
    throw e;
   }
   if(typeof created.id!=='string')throw new Error('Calendar creation could not be confirmed. Retry to recover it.');
   calendar=created.id;
  }
  const {data:saved,error:saveError}=await c.supabase.from('calendar_connections').update({calendar_id:calendar}).eq('workspace_id',c.workspace.id).eq('user_id',c.user.id).eq('connection_id',expected).eq('lease_id',lease).select('connection_id');
  if(saveError || !saved?.length)throw new Error('Calendar created but its connection could not be saved. Retry to recover it.');
 }
 if(!calendar)throw new Error('Calendar unavailable.');
 const counts={created:0,updated:0,unchanged:0};
 async function renewLease(){
  const {data:currentRole,error:roleError}=await c!.supabase.rpc('workspace_role',{p_workspace:c!.workspace.id});
  if(roleError||!['owner','manager'].includes(currentRole))throw new Error('Calendar approval access changed. Sync stopped.');
  if(p.releaseId!=='cleanup'){
   const {data:visible,error:visibilityError}=await c!.supabase.from('releases').select('id').eq('workspace_id',c!.workspace.id).eq('id',p.releaseId).is('archived_at',null).maybeSingle();
   if(visibilityError||!visible)throw new Error('Project access changed. Sync stopped.');
  }
  const {data:active,error:activeError}=await c!.supabase.from('calendar_connections').update({lease_until:new Date(Date.now()+120000).toISOString()}).eq('workspace_id',c!.workspace.id).eq('user_id',c!.user.id).eq('connection_id',expected).eq('lease_id',lease).gt('lease_until',new Date().toISOString()).not('encrypted_refresh_token','is',null).select('connection_id');
  if(activeError || !active?.length)throw new Error('Calendar connection changed. Sync stopped.');
 }
 for(const old of p.removals||[]){await renewLease();await removeManagedEvent(token,calendar,old);removed++;}
 for(const item of items){
  await renewLease();
  const outcome=await upsertEvent(token,calendar,item,fetch,p.reviewed.find(r=>r.id===item.id)?.google?.etag??null);counts[outcome]++;completed++;
 }
 await record('confirmed');
 return {error:null,message:`Synced ${completed} events: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} already current. Removed ${removed} obsolete events.`};
 }catch(e){if(recorded)await record('partial').catch(()=>null);return {error:`${safeError(e)} ${completed} events confirmed and ${removed} removals confirmed so far. Local dates are unchanged by sync. Retrying reuses the same event IDs.`,message:''};}
 finally{if(c && claimed)await c.supabase.from('calendar_connections').update({lease_id:null,lease_until:null}).eq('workspace_id',c.workspace.id).eq('user_id',c.user.id).eq('lease_id',lease);}
}
export async function disconnectCalendar(expected:string){
 const {workspace,user}=await requireWorkspace();const {supabase}=await requireUser();
 const {data,error}=await supabase.from('calendar_connections').update({encrypted_refresh_token:null,connection_id:randomUUID()}).eq('workspace_id',workspace.id).eq('user_id',user.id).eq('connection_id',expected).or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`).select('user_id');
 return {error:error || !data?.length?'Wait for any active sync to finish, then reload and retry.':null};
}

export async function setupCalendarSources(expected:string){
 await requireWorkspace();
 try{
  const c=await connection(expected);const token=await access(c);
  const min=new Date();min.setDate(min.getDate()-30);const max=new Date();max.setDate(max.getDate()+180);
  const query=new URLSearchParams({timeMin:min.toISOString(),timeMax:max.toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'30'});
  const list=await calendarRequest(token,`calendars/primary/events?${query}`);
  return {error:null,sources:(list.items??[]).filter((e:{status?:string})=>e.status!=='cancelled').map((e:{id:string;summary?:string;description?:string;start?:{date?:string;dateTime?:string}})=>({id:`calendar:${e.id}`,label:`${e.summary||'Untitled event'} · ${e.start?.date||e.start?.dateTime||''}`,text:[e.summary,e.start?.date||e.start?.dateTime,e.description].filter(Boolean).join('\n').slice(0,12000)})) as {id:string;label:string;text:string}[]};
 }catch{return {error:'To scan existing events, reconnect Calendar with event read access. Add calendar.events.readonly in Google Auth Platform → Data Access first.',sources:[]};}
}

// Read only events that map to records this member can still access.
export async function assistantCalendarEvents(){
 const {workspace}=await requireWorkspace();
 try{
  const status=await calendarStatus();if(!status.connectionId||!status.calendarId)return {sources:[],error:'No Dopio Google calendar is available. Connect and preview a project first.'};
  const c=await connection(status.connectionId);const token=await access(c);const data=await loadWorkspace(workspace.id);
  const permitted=new Set([...data.tasks.map(t=>eventId(workspace.id,'task',t.id)),...data.releases.map(r=>eventId(workspace.id,'release',r.id))]);
  const response=await calendarRequest(token,`calendars/${encodeURIComponent(status.calendarId)}/events?maxResults=250`);
  const sources=(response.items??[]).filter((e:{id:string;status:string})=>permitted.has(e.id)&&e.status!=='cancelled').map((e:{id:string;summary:string;start:{date?:string;dateTime?:string};end:{date?:string;dateTime?:string}})=>({key:`calendar:${e.id}`,label:e.summary||'Calendar event',href:'/?view=Calendar',record:{id:e.id,title:e.summary,start:e.start,end:e.end}}));
  return {sources,error:response.nextPageToken?'Calendar results are limited to the first 250 events. Narrow the review in Calendar.':null};
 }catch(e){return {sources:[],error:safeError(e)};}
}
