'use client';
import {useEffect,useState} from 'react';
import {coordinationApprovalProjects} from '@/app/workspace/coordination-actions';
import ReleaseCoordination from './ReleaseCoordination';
export default function CoordinationApprovals(){
 const [projects,setProjects]=useState<Awaited<ReturnType<typeof coordinationApprovalProjects>>>([]);
 useEffect(()=>{let live=true;const load=async()=>{try{const p=await coordinationApprovalProjects();if(live)setProjects(p);}catch{/* Existing approval flows remain available if setup is incomplete. */}};void load();const t=setInterval(()=>void load(),15000);return()=>{live=false;clearInterval(t);};},[]);
 if(!projects.length)return null;
 return <section className="panel"><h2>Release coordination approvals</h2><p>AI-generated stakeholder emails awaiting your review.</p>{projects.map(p=><details key={p.release}><summary>{p.count} email action{p.count===1?'':'s'} awaiting approval</summary><ReleaseCoordination release={p.release}/></details>)}</section>;
}
