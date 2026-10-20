"use server";
import {requireWorkspace,requireUser} from '@/lib/auth/session';
import {uuidPattern} from '@/lib/workspace/validation';
export async function loadContactsAndOwners(){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 const [contacts,tasks]=await Promise.all([
  supabase.from('workspace_contacts').select('id,name,email,role,version').eq('workspace_id',workspace.id).order('name').limit(1001),
  supabase.from('tasks').select('id,title,artist_id,release_id,owner_contact_id,version').eq('workspace_id',workspace.id).is('archived_at',null).order('created_at',{ascending:false}).limit(1001),
 ]);
 if(contacts.error || tasks.error)return {error:'Run migration 012 in Supabase, then reload contacts. If already applied, try refreshing your session.',contacts:[],tasks:[]};
 if(contacts.data.length>1000 || tasks.data.length>1000)return {error:'This assignment panel supports up to 1,000 contacts and tasks.',contacts:[],tasks:[]};
 return {error:null,contacts:contacts.data as {id:string;name:string;email:string;role:string;version:number}[],tasks:tasks.data as {id:string;title:string;artist_id:string|null;release_id:string|null;owner_contact_id:string|null;version:number}[]};
}
export async function saveContact(id:string|null,form:FormData){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 const name=String(form.get('name')??'').trim(),email=String(form.get('email')??'').trim().toLowerCase(),role=String(form.get('role')??'').trim();
 if((id && !uuidPattern.test(id)) || !name || name.length>100 || role.length>100 || email.length>254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))return {error:'Enter a name and a valid email address, or leave email blank.'};
 const query=id?supabase.from('workspace_contacts').update({name,email,role}).eq('workspace_id',workspace.id).eq('id',id).eq('version',Number(form.get('version'))):supabase.from('workspace_contacts').insert({workspace_id:workspace.id,name,email,role});
 const {error}=await query.select('id').single();
 return {error:error?.code==='23505'?'A contact with this email already exists.':error?.code==='PGRST116'?'Contact changed. Reload before saving.':error?'Contact could not be saved.':null};
}
export async function deleteContact(id:string,version:number){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(!uuidPattern.test(id))return {error:'Invalid contact.'};
 const {error}=await supabase.from('workspace_contacts').delete().eq('workspace_id',workspace.id).eq('id',id).eq('version',version).select('id').single();
 return {error:error?.code==='23503'?'Unassign this contact’s tasks before deleting them.':error?'Contact could not be deleted.':null};
}
export async function assignTaskOwner(task:string,version:number,owner:string|null){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(!uuidPattern.test(task) || (owner!==null && !uuidPattern.test(owner)) || !Number.isInteger(version))return {error:'Choose a valid task and contact.'};
 const {error}=await supabase.rpc('assign_task_owner',{p_workspace:workspace.id,p_task:task,p_version:version,p_owner:owner});
 return {error:error?.code==='40001'?'This task changed. Reload the panel before assigning.':error?'Assignment could not be saved. Reload and choose a contact from this workspace.':null};
}
