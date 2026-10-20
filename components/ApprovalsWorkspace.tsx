"use client";

import {useEffect,useState,type ReactNode} from 'react';
import Link from 'next/link';
import Icon from './DopioIcon';
import ReleaseEmailApprovals from './ReleaseEmailApprovals';
import type {WorkspaceData} from '@/lib/workspace/types';
import type {DeadlineProposal} from '@/lib/workspace/email-types';
import {DEFAULT_TIME_ZONE} from '@/lib/workspace/rules';

export default function ApprovalsWorkspace({data,onData,renderTask}:{data:WorkspaceData;onData:(data:WorkspaceData)=>void;renderTask:(p:DeadlineProposal)=>ReactNode}) {
 const [selected,setSelected]=useState(''),[category,setCategory]=useState('All'),[search,setSearch]=useState(''),[status,setStatus]=useState('All statuses'),[sort,setSort]=useState('newest');
 useEffect(()=>{const select=()=>{const match=window.location.hash.match(/^#proposal-([0-9a-f-]{36})$/i);if(match){setSelected(match[1]);setCategory('All');setStatus('All statuses');setSearch('');}};select();window.addEventListener('hashchange',select);return()=>window.removeEventListener('hashchange',select);},[]);
 const entries=[
  ...data.email.proposals.map(p=>({id:p.id,kind:'task' as const,title:p.task_title,artist:p.artist_name,project:p.release_title,status:p.status,created:p.created_at,messageId:p.message_id})),
  ...(data.email.releaseProposals??[]).map(p=>({id:p.id,kind:'release' as const,title:'Release date change',artist:p.artist_name,project:p.release_title,status:p.status,created:p.created_at,messageId:p.message_id}))
 ].map(p=>({...p,source:data.email.messages.find(m=>m.id===p.messageId)}));
 const categories=['All','Email suggestions','Team changes'];
 const matchesCategory=(p:typeof entries[number],c:string)=>c==='All'||(c==='Team changes'?p.source?.source==='team':p.source?.source!=='team');
 const filtered=entries.filter(p=>matchesCategory(p,category)&&(status==='All statuses'||p.status===status)&&[p.title,p.artist,p.project,p.source?.subject,p.source?.sender].join(' ').toLowerCase().includes(search.toLowerCase())).sort((a,b)=>(sort==='newest'?-1:1)*(a.created.localeCompare(b.created)||a.id.localeCompare(b.id)));
 const current=filtered.find(p=>p.id===selected)??filtered[0];
 const task=data.email.proposals.find(p=>p.id===current?.id);
 const release=data.email.releaseProposals?.find(p=>p.id===current?.id);
 const stamp=(value:string)=>new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:data.timeZone??DEFAULT_TIME_ZONE});
 return <section className="approvals-workspace">
  <nav className="approvals-tabs" aria-label="Approval source">{categories.map(c=><button key={c} aria-pressed={category===c} className={category===c?'selected':''} onClick={()=>setCategory(c)}>{c} ({entries.filter(p=>matchesCategory(p,c)).length})</button>)}</nav>
  <div className="approvals-layout">
   <aside className="panel approvals-list">
    <div className="approvals-tools"><input aria-label="Search approvals" placeholder="Search approvals…" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Sort approvals" value={sort} onChange={e=>setSort(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select><select aria-label="Approval status" value={status} onChange={e=>setStatus(e.target.value)}>{['All statuses','pending','approved','rejected','conflict'].map(s=><option key={s}>{s}</option>)}</select></div>
    {filtered.map(p=><button key={p.id} className={'approvals-item '+(p.id===current?.id?'selected':'')} aria-pressed={p.id===current?.id} onClick={()=>setSelected(p.id)}>
     <span className="soft-icon"><Icon name={p.kind==='release'?'calendar':'tasks'} size={24}/></span>
     <span className="approvals-item-copy"><strong>{p.artist}{p.project?' · '+p.project:''}</strong><span>{p.kind==='release'?p.title:'Task deadline: '+p.title}</span><small>{p.source?.source==='team'?'From team conversation':p.source?.source==='sample'?'From sample email':'From imported email'}</small></span>
     <span className="approvals-item-meta"><small>{stamp(p.created)}</small><span className={'badge '+(p.status==='pending'?'amber':p.status==='approved'?'green':p.status==='conflict'?'red':'slate')}>{p.status}</span></span>
    </button>)}
    {!filtered.length&&<div className="empty-state"><Icon name="shield" size={32}/><h2>{entries.length?'No matching approvals':'You’re all caught up'}</h2><p>{entries.length?'Try another search or filter.':'Reviewed email and team-message date proposals will appear here.'}</p></div>}
   </aside>
   <div className="approvals-detail" key={current?.id??'empty'}>
    {current?<><header className="approvals-detail-heading"><span className="soft-icon"><Icon name="calendar" size={28}/></span><div><p>{current.kind==='release'?'Release date change':'Task deadline change'}</p><h2>{current.artist}{current.project?' · '+current.project:''}</h2><small>{stamp(current.created)} · {current.source?.source==='team'?'Team message review':'Email review'}</small></div><span className={'badge '+(current.status==='pending'?'amber':'slate')}>{current.status}</span></header>
     {task&&renderTask(task)}
     {release&&<ReleaseEmailApprovals data={data} proposalId={release.id} onData={onData}/>}
     <footer className="approvals-related"><h3>Related items</h3>{release&&<Link href={'/projects/'+release.release_id}>View project →</Link>}{task?.task_id&&<Link href={'/?view=Tasks&task='+task.task_id}>View task →</Link>}{current.source&&<details><summary>Original {current.source.source==='team'?'team message':'email'}</summary><strong>{current.source.subject}</strong><p>From {current.source.sender}</p><p className="approvals-source">{current.source.body}</p></details>}</footer>
    </>:<div className="empty-state"><Icon name="shield" size={40}/><h2>Review changes here</h2><p>Select a proposal to see its evidence and decide what happens next.</p></div>}
   </div>
  </div>
 </section>;
}
