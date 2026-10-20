"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import Icon from './DopioIcon';
import type {WorkspaceData} from '@/lib/workspace/types';
import {buildActivityFeed,type AssistantReceipt} from '@/lib/workspace/activity-feed';
import {activityAssistantReceipts} from '@/app/workspace/activity-actions';
import {DEFAULT_TIME_ZONE,workspaceDay} from '@/lib/workspace/rules';
export default function ActivityWorkspace({data,user,today}:{data:WorkspaceData;user:string;today:string}){
 const [filter,setFilter]=useState('All Activity'),[search,setSearch]=useState(''),[days,setDays]=useState('30');
 const [extra,setExtra]=useState<{receipts:AssistantReceipt[];error:string|null}|null>(null);
 const [retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;activityAssistantReceipts(data.workspaceId??'').then(r=>{if(active)setExtra(r);}).catch(()=>{if(active)setExtra({receipts:[],error:'Could not load Dopio actions. Retry.'});});return()=>{active=false;};},[data.workspaceId,retry]);
 const zone=data.timeZone??DEFAULT_TIME_ZONE;
 const cutoff=new Date(today+'T12:00:00Z');cutoff.setUTCDate(cutoff.getUTCDate()-(Number(days)-1));
 const feed=buildActivityFeed(data.activity,extra?.receipts??[],user).filter(a=>days==='all'||workspaceDay(new Date(a.at),zone)>=cutoff.toISOString().slice(0,10));
 const groups=['DOPIO AI','My Team','Me'] as const;
 const shown=feed.filter(a=>(filter==='All Activity'||a.category===filter)&&a.sentence.toLowerCase().includes(search.toLowerCase()));
 return <div className="activity-workspace"><div className="page-heading"><div><p className="eyebrow">ACTIVITY</p><h1>Everything in one place.</h1><p className="subtitle">What Dopio did, what your team did, and what you did.</p></div><select aria-label="Activity date range" value={days} onChange={e=>setDays(e.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All available activity</option></select></div>
 <div className="today-stats tasks-stats">{['All Activity',...groups].map((g,i)=><button key={g} className={`today-stat ${i===2?'blue':'purple'}`} onClick={()=>setFilter(g)} aria-pressed={filter===g}><span className="stat-icon"><Icon name={i<2?'sparkle':'users'}/></span><span><strong>{g==='DOPIO AI'&&!extra?'…':feed.filter(a=>g==='All Activity'||a.category===g).length}</strong><span>{g==='All Activity'?'Total activity':g}</span></span></button>)}</div>
 <div className="today-toolbar"><div className="tabs" role="group" aria-label="Activity source">{['All Activity',...groups].map(g=><button key={g} className={filter===g?'selected':''} aria-pressed={filter===g} onClick={()=>setFilter(g)}>{g}</button>)}</div><input aria-label="Search activity" placeholder="Search activity…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
 {!extra&&<p role="status">Loading verified Dopio actions…</p>}{extra?.error&&<p role="alert" className="auth-feedback error">{extra.error} <button className="text-link" onClick={()=>{setExtra(null);setRetry(r=>r+1);}}>Retry</button></p>}
 <div className={`activity-columns ${filter!=='All Activity'?'single':''}`}>{(filter==='All Activity'?[...groups,...(shown.some(a=>a.category==='System')?['System']:[])]:[filter]).map(g=><section className="panel activity-column" key={g}><header><Icon name={g==='DOPIO AI'?'sparkle':g==='My Team'?'users':'check'} size={23}/><div><h2>{g}</h2><p>{g==='DOPIO AI'?'Confirmed assistant actions':g==='My Team'?'Changes by other workspace members':g==='Me'?'Your edits and decisions':'Administrative changes'}</p></div></header>{shown.filter(a=>a.category===g).length?shown.filter(a=>a.category===g).map((a,i,rows)=>{const day=workspaceDay(new Date(a.at),zone);return <div key={a.id}>{(!i||workspaceDay(new Date(rows[i-1].at),zone)!==day)&&<h3 className="activity-day">{day===today?'Today':new Date(day+'T12:00:00Z').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'})}</h3>}<article className="activity-story"><span className="soft-icon"><Icon name={a.category==='DOPIO AI'?'sparkle':'activity'} size={17}/></span><div><Link href={a.href}>{a.sentence}</Link><details><summary>Details</summary><p><time dateTime={a.at}>{new Date(a.at).toLocaleString('en-US',{timeZone:zone})}</time> · {zone}</p>{a.activity?.previous_data&&a.activity.current_data&&<dl>{Object.keys(a.activity.current_data).filter(k=>!['version','updated_at'].includes(k)&&JSON.stringify(a.activity!.previous_data?.[k])!==JSON.stringify(a.activity!.current_data?.[k])).map(k=><div key={k}><dt>{k.replaceAll('_',' ')}</dt><dd>{JSON.stringify(a.activity!.previous_data?.[k]??null)} → {JSON.stringify(a.activity!.current_data?.[k]??null)}</dd></div>)}</dl>}</details></div></article></div>;}):<p className="today-empty">No matching activity available.</p>}</section>)}</div>
 <p className="today-timezone">Only activity your account can access is shown. Dopio attribution uses saved assistant action receipts; older edits keep their recorded author. Email drafts, sends, and team messages are not all recorded in this feed yet.</p>
 </div>;
}
