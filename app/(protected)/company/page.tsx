import Link from 'next/link';
import {requireWorkspace,requireUser} from '@/lib/auth/session';
import CompanyControls from '@/components/CompanyControls';
export default async function CompanyPage(){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 const month=new Date().toISOString().slice(0,7)+'-01';
 const [team,workspaces,limit,usage,artists,releases,tasks,roster,assignments]=await Promise.all([
 supabase.rpc('workspace_team',{p_workspace:workspace.id}),
 supabase.from('workspaces').select('id,name'),
 supabase.from('workspace_ai_limits').select('monthly_requests').eq('workspace_id',workspace.id).maybeSingle(),
 supabase.from('workspace_ai_months').select('month,attempts').eq('workspace_id',workspace.id).eq('month',month).limit(1),
 supabase.from('artists').select('record_id,name,version').eq('workspace_id',workspace.id).not('archived_at','is',null).limit(1000),
 supabase.from('releases').select('id,title,version').eq('workspace_id',workspace.id).not('archived_at','is',null).limit(1000),
 supabase.from('tasks').select('id,title,version').eq('workspace_id',workspace.id).not('archived_at','is',null).limit(1000),
 supabase.from('artists').select('record_id,name').eq('workspace_id',workspace.id).is('archived_at',null),
 supabase.from('artist_access').select('artist_id,user_id').eq('workspace_id',workspace.id)
 ]);
 if(team.error)return <main className="onboarding-screen company-screen"><section className="onboarding-card"><h1>Company controls need migration 021</h1><Link href="/">Back to workspace</Link></section></main>;
 const archived=[...(artists.data||[]).map(a=>({kind:'artist',id:a.record_id,title:a.name,version:a.version})),...(releases.data||[]).map(r=>({...r,kind:'release'})),...(tasks.data||[]).map(t=>({...t,kind:'task'}))];
 return <main className="onboarding-screen company-screen"><section className="onboarding-card workspace-setup company-shell"><Link className="back-link" href="/">← Back to workspace</Link><header className="company-page-heading"><p className="eyebrow">{workspace.name}</p><h1>Company settings</h1><p>Manage your people, usage, and workspace data.</p></header><CompanyControls workspace={workspace.id} team={team.data} workspaces={workspaces.data||[]} cap={limit.data?.monthly_requests??200} usage={usage.data?.[0]} archived={archived} roster={roster.data||[]} assignments={assignments.data||[]} assignmentError={!!assignments.error}/></section></main>;
}
