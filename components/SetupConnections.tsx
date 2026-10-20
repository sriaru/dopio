"use client";
import {useEffect,useState} from 'react';
import {useSearchParams} from 'next/navigation';

import {gmailStatus,startGmailConnection} from '@/app/gmail/actions';
import {calendarStatus,connectCalendar} from '@/app/calendar/actions';
export default function SetupConnections(){
 const params=useSearchParams();const outcome=params.get('gmail')||params.get('calendar');
 const [gmail,setGmail]=useState<Awaited<ReturnType<typeof gmailStatus>>|null>(null);
 const [calendar,setCalendar]=useState<Awaited<ReturnType<typeof calendarStatus>>|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');const [revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;Promise.all([gmailStatus(),calendarStatus()]).then(([g,c])=>{if(active){setGmail(g);setCalendar(c);setError('');}}).catch(()=>{if(active)setError('Could not check your connections. Try refreshing status.');});return()=>{active=false;};},[revision]);
 return <section className="setup-connections"><div className="setup-section-heading"><div><p className="eyebrow">2 · OPTIONAL CONNECTIONS</p><h2>Connect your tools when you’re ready</h2></div><button className="text-link" onClick={()=>setRevision(r=>r+1)}>Refresh status</button></div><p>Your artist brief sets up your roster. Connect Gmail for selected email updates and Calendar for release scheduling, now or later.</p>{outcome && <p role="status" className="email-notice">{outcome==='connected'?'Google connection saved. You can continue to your dashboard.':'Google connection did not finish. Reconnect and grant the requested permissions; check Google setup if it fails again.'}</p>}{error && <p role="alert">{error}</p>}<div className="connection-cards">{[
 {name:'Gmail',value:gmail,connect:()=>startGmailConnection(false,true),detail:'Import selected emails and review team messages before sending.'},
 {name:'Google Calendar',value:calendar,connect:()=>connectCalendar(true),detail:'Preview release and task dates before syncing them to Google.'},
 ].map(c=><article key={c.name}><span className={`connection-state ${c.value?.connectionId?'connected':''}`}>{!c.value?'Checking…':c.value.error?'Setup needs attention':c.value.connectionId?'Connected':'Not connected'}</span><h3>{c.name}</h3><p>{c.value?.connectionId?c.value.email:c.detail}</p>{c.value?.error&&<p role="alert">{c.value.error}</p>}<button className="button secondary" disabled={busy||!c.value?.configured} onClick={async()=>{setBusy(true);setError('');try{const r=await c.connect();if(r?.error)setError(r.error);}catch{setError('Could not start the connection. Please try again.');}finally{setBusy(false);}}}>{c.value?.connectionId?'Reconnect':'Connect'} →</button></article>)}</div><p className="setup-hint">Optional: you can finish setup without either connection. Approve your brief before connecting, since Google takes you away from this page and unsaved text is cleared.</p></section>;
}
