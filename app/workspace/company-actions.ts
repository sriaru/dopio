"use server";
import {randomBytes} from 'node:crypto';
import {cookies} from 'next/headers';
import {revalidatePath} from 'next/cache';
import {requireWorkspace,requireUser} from '@/lib/auth/session';
import {uuidPattern} from '@/lib/workspace/validation';
export async function switchWorkspace(id:string){
 const {supabase,user}=await requireUser();if(!uuidPattern.test(id))return {error:'Invalid workspace.'};
 const {data}=await supabase.from('workspace_members').select('workspace_id').eq('workspace_id',id).eq('user_id',user.id).maybeSingle();
 if(!data)return {error:'Workspace unavailable.'};
 (await cookies()).set('aura-workspace',id,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production'&&process.env.NEXT_PUBLIC_APP_URL?.startsWith('https:')===true,path:'/'});
 revalidatePath('/','layout');return {error:null};
}
export async function inviteMember(email:string,role:string){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();const token=randomBytes(32).toString('hex');
 const {error}=await supabase.rpc('create_workspace_invite',{p_workspace:workspace.id,p_email:email,p_role:role,p_token:token});
 return error?{error:'Only the owner can invite a valid email address.'}:{error:null,token};
}
export async function acceptInvite(token:string){
 const {supabase}=await requireUser();
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token.trim()))return {error:'Paste a valid invitation code.'};
 const {data,error}=await supabase.rpc('accept_workspace_invite',{p_token:token.trim()});
 if(error)return {error:'This invitation expired, was revoked, or belongs to a different email address.'};
 return switchWorkspace(data);
}
export async function updateMember(user:string,role:string|null){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 const {error}=await supabase.rpc('manage_workspace_member',{p_workspace:workspace.id,p_user:user,p_role:role});
 revalidatePath('/company');return {error:error?'Only the owner can change another member’s access.':null};
}
export async function revokeInvite(id:string){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 const {error}=await supabase.rpc('revoke_workspace_invite',{p_workspace:workspace.id,p_id:id});revalidatePath('/company');return {error:error?'Could not revoke invitation.':null};
}
export async function setAIRequestLimit(limit:number){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(!Number.isInteger(limit)||limit<0||limit>10000)return {error:'Choose a limit from 0 to 10,000.'};
 const {error}=await supabase.from('workspace_ai_limits').upsert({workspace_id:workspace.id,monthly_requests:limit});revalidatePath('/company');
 return {error:error?'Only the owner can change the AI request cap.':null};
}
export async function restoreArchived(kind:string,id:string,version:number){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 const {error}=await supabase.rpc('archive_workspace_record',{p_workspace:workspace.id,p_kind:kind,p_id:id,p_version:version,p_archive:false});
 revalidatePath('/','layout');return {error:error?'Record changed or dates conflict. Reload and review before restoring.':null};
}
export async function exportWorkspace(){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 const {data:role}=await supabase.rpc('workspace_role',{p_workspace:workspace.id});
 if(role!=='owner')return {error:'Only the workspace owner can export company data.'};
 const records:Record<string,unknown[]>={};
 for(const table of ['artists','releases','tasks','workspace_contacts','artist_briefs','inbox_messages','deadline_proposals','task_email_drafts','task_email_sends','chat_messages','workspace_activity']){
 const all:unknown[]=[];
 for(let offset=0;;offset+=500){
 const {data,error}=await supabase.from(table).select('*').eq('workspace_id',workspace.id).order(table==='artists'?'record_id':table==='artist_briefs'?'artist_id':table==='task_email_sends'?'draft_id':'id').range(offset,offset+499);
 if(error)return {error:'Export failed. No partial export was produced.'};all.push(...data);if(data.length<500)break;
 if(all.length>50000)return {error:'This workspace requires an administrator database export.'};
 }records[table]=all;
 }
 return {error:null,json:JSON.stringify({format:'aura-workspace-export-v1',workspace,exported_at:new Date().toISOString(),records},null,2)};
}

export async function setArtistAccess(artist:string,user:string,allow:boolean){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(!uuidPattern.test(artist)||!uuidPattern.test(user)||typeof allow!=='boolean')return {error:'Choose a valid artist and teammate.'};
 const {error}=await supabase.rpc('assign_artist_access',{p_workspace:workspace.id,p_artist:artist,p_user:user,p_allow:allow});
 revalidatePath('/','layout');return {error:error?'Only the owner can assign artist access. Apply migration 026 first.':null};
}
