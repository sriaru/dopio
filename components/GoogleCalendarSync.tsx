"use client";
import {useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {calendarStatus,connectCalendar,previewCalendar,syncCalendar,disconnectCalendar} from '@/app/calendar/actions';
import type {WorkspaceData} from '@/lib/workspace/types';
import type {CalendarItem,CalendarRemoval} from '@/lib/calendar/events';
export default function GoogleCalendarSync({data,releaseId,onSynced}:{data:WorkspaceData;releaseId?:string;onSynced?:()=>void}){
 const guard=useRef(false);
 const [status,setStatus]=useState<Awaited<ReturnType<typeof calendarStatus>>|null>(null);
 const [release,setRelease]=useState(releaseId??'');const [items,setItems]=useState<CalendarItem[]>([]);const [ticket,setTicket]=useState('');const [undated,setUndated]=useState(0);
 const [removals,setRemovals]=useState<CalendarRemoval[]>([]);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 useEffect(()=>{let active=true;calendarStatus().then(s=>{if(active)setStatus(s);}).catch(()=>{if(active)setError('Could not load Calendar status.');});return()=>{active=false;};},[]);
 async function reload(){setStatus(await calendarStatus());setTicket('');setItems([]);}
 async function run(action:()=>Promise<void>){if(guard.current)return;guard.current=true;setBusy(true);setError('');setNotice('');try{await action();}catch{setTicket('');setError('Calendar request could not be confirmed. Reload status and preview again.');}finally{setBusy(false);guard.current=false;}}
 const callback=useSearchParams().get('calendar');
 const callbackErrors:Record<string,string>={
  configuration:'Calendar server configuration is incomplete. Check the callback setting and restart Dopio.',
  session:'The connection session expired or did not match. Return to Dopio and connect again in the same browser.',
  token:'Google could not exchange the authorization code. Check the client credentials and exact Calendar callback URL, then reconnect.',
  profile:'Google account identity could not be verified. Grant the email permission and reconnect.',
  database:'Google authorization finished, but Dopio could not save the connection. Confirm migration 011 ran successfully in your Supabase project, then reconnect.',
 };
 return <section className="panel release-plan calendar-surface"><h2>Google Calendar</h2>
 <p>Preview a project and its open, dated tasks, then sync all-day events to your dedicated Dopio calendar. Sync again to apply later changes.</p>
 {callback && <p role="status" className="email-notice">{callback==='connected'?'Google Calendar connected.':callback==='account'?'Reconnect using the same Google account as before to preserve your Dopio calendar.':callback==='busy'?'A sync is running. Reconnect after it finishes.':callback==='permission'?'Grant all requested Calendar permissions when connecting.':callback==='cancelled'?'Calendar connection cancelled.':callbackErrors[callback] || 'Calendar connection failed. Check the setup instructions and reconnect.'}</p>}
 {(error || status?.error) && <p role="alert" className="auth-feedback error">{error || status?.error}</p>}
 {notice && <p role="status" className="email-notice">{notice}</p>}
 {!status?<div><p>{error?'Connection status unavailable.':'Loading connection…'}</p>{error&&<button className="button secondary" disabled={busy} onClick={()=>run(reload)}>Retry connection status</button>}</div>:<fieldset disabled={busy}>
 <p>{status.connectionId?`Account saved: ${status.email}. Google access is checked during preview and sync.`:'Google Calendar is not connected.'}</p>
 {status.lastSync&&<p>Last sync attempt ({status.lastSync.created_at}): {status.lastSync.status==='running'?'No final result recorded — preview to reconcile':status.lastSync.status==='partial'?'Stopped before all changes were confirmed':'Confirmed by Google'}. {status.lastSync.confirmed_events} events and {status.lastSync.confirmed_removals} removals recorded. Saving local dates does not sync Google.</p>}
 <div className="plan-actions"><button type="button" className="button secondary" disabled={!status.configured} onClick={()=>run(async()=>{const r=await connectCalendar();if(r?.error)setError(r.error);})}>{status.connectionId?'Reconnect Google Calendar':'Connect Google Calendar'}</button>
 <button className="button secondary" type="button" onClick={()=>run(reload)}>Reload status</button>
 {status.connectionId && <button type="button" className="button secondary" onClick={()=>run(async()=>{const r=await disconnectCalendar(status.connectionId!);if(r.error)setError(r.error);else{await reload();setNotice('Disconnected from Dopio. Existing Google events remain. You can remove Google authorization in your Google Account settings; that may also disconnect Gmail if it uses the same app.');}})}>Disconnect</button>}</div>
 {status.connectionId && <><label>Project<select value={release} onChange={e=>{setRelease(e.target.value);setTicket('');setItems([]);}}><option value="">Choose a project</option><option value="cleanup">Clean up obsolete events only</option>{data.releases.filter(r=>!releaseId || r.id===releaseId).map(r=><option value={r.id} key={r.id}>{data.artists.find(a=>a.record_id===r.artist_id)?.name} — {r.title}</option>)}</select></label>
 <button className="button secondary" type="button" disabled={!release} onClick={()=>run(async()=>{setTicket('');setItems([]);const r=await previewCalendar(status.connectionId!,release);if(r.error)setError(r.error);else{setItems(r.items);setRemovals(r.removals);setUndated(r.undated);setTicket(r.ticket);}})}>Preview calendar sync</button>
 {ticket && <><h3>Review {items.length} events for {status.email}</h3><p>{status.calendarId?'Update the dedicated Dopio calendar.':'Create or recover the dedicated Dopio calendar on approval.'} Existing Dopio events will be updated to these titles and dates, as shown below. Changes made in Google after this preview require a new review.</p><div className="surface-table" role="region" aria-label="Calendar preview" tabIndex={0}><table><thead><tr><th>Event</th><th>Currently in Google</th><th>Proposed all-day date</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>{i.summary}</td><td>{i.google?`${i.google.summary} — ${i.google.date}`:"New event"}</td><td>{i.date}</td></tr>)}</tbody></table></div>
 {!!undated && <p>{undated} open tasks have no deadline and will be skipped.</p>}
 {removals.length>0&&<div className="info-box"><h3>Also remove {removals.length} obsolete Dopio events across this workspace</h3><ul>{removals.map(r=><li key={r.id}>{r.summary} — {r.date}</li>)}</ul><p>These records were completed, archived, or had their dates cleared. Events for deleted or inaccessible records are retained for manual review in Google.</p></div>}<p>No guests, invitations, or event reminders are added. Only the obsolete Dopio events listed above will be removed. No changes are pulled from Google into Dopio.</p>
 <button className="button primary" type="button" onClick={()=>run(async()=>{const r=await syncCalendar(status.connectionId!,ticket);setTicket('');if(r.error)setError(r.error);else {setNotice(r.message);onSynced?.();}setStatus(await calendarStatus());})}>Approve and sync to Google Calendar</button></>}
 </>}
 {busy && <p role="status">Working… Keep this page open.</p>}
 </fieldset>}
 <details><summary>Connection help</summary><p>Allow the requested Calendar permissions when connecting. If access is blocked, ask your workspace administrator to check your Google test-user access and the deployment’s Calendar configuration. Reconnect the same Google account to keep using your existing Dopio calendar.</p></details>
 </section>;
}
