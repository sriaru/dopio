'use server';
import {requireUser,requireWorkspace} from '@/lib/auth/session';
export async function loadCoordination(release:string){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 const {data:runs,error}=await supabase.from('coordination_runs').select('*').eq('workspace_id',workspace.id).eq('release_id',release).order('created_at',{ascending:false}).limit(1);
 if(error)return {error:'Release coordination needs migration 039 and server setup.'};
 const run=runs?.[0];if(!run)return {run:null};
 const tables=['coordination_deliverables','coordination_blockers','coordination_actions','coordination_observations','coordination_events'] as const;
 const results=await Promise.all(tables.map(t=>supabase.from(t).select('*').eq('run_id',run.id).order(t==='coordination_blockers'?'updated_at':t==='coordination_deliverables'?'title':'created_at',{ascending:t==='coordination_deliverables'}).limit(100)));
 if(results.some(r=>r.error))return {error:'Could not load the coordination workspace.'};
 return {run,deliverables:results[0].data??[],blockers:results[1].data??[],actions:results[2].data??[],observations:results[3].data??[],events:results[4].data??[]};
}
export async function configureCoordination(release:string,senders:string[],demo:boolean,hours:number){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 const {error}=await supabase.rpc('configure_coordination',{w:workspace.id,r:release,senders,demo,hours});
 return {error:error?'Could not enable coordination. Check manager access, Gmail connection and stakeholder addresses.':null};
}
export async function coordinationDecision(kind:'approve'|'reject'|'pause'|'verify'|'decline'|'requirements',id:string,version=0,body=''){
 await requireWorkspace();const {supabase}=await requireUser();
 let result;
 if(kind==='approve'||kind==='reject')result=await supabase.rpc('review_coordination_action',{i:id,v:version,body,approve:kind==='approve'});
 else if(kind==='pause')result=await supabase.rpc('pause_coordination',{i:id});
 else if(kind==='verify'||kind==='decline')result=await supabase.rpc('verify_coordination_deliverable',{i:id,accept:kind==='verify'});
 else if(kind==='requirements')result=await supabase.rpc('set_coordination_requirements',{i:id,extensions:body.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean)});
 else return {error:'Unknown action'};
 return {error:result.error?'The record changed or access is unavailable. Reload and review again.':null};
}
export async function coordinationApprovalProjects(){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 const {data:runs,error}=await supabase.from('coordination_runs').select('id,release_id').eq('workspace_id',workspace.id).limit(100);
 if(error||!runs?.length)return [];
 const {data:actions}=await supabase.from('coordination_actions').select('run_id').in('run_id',runs.map(r=>r.id)).eq('status','draft').limit(1000);
 return runs.filter(r=>actions?.some(a=>a.run_id===r.id)).map(r=>({release:r.release_id,count:actions?.filter(a=>a.run_id===r.id).length??0}));
}
