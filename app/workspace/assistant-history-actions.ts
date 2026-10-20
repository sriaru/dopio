'use server';
import {requireUser,requireWorkspace} from '@/lib/auth/session';
import {uuidPattern} from '@/lib/workspace/validation';
export async function assistantHistory(){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 const {data,error}=await supabase.from('assistant_conversations').select('id,title,version,updated_at').eq('workspace_id',workspace.id).order('updated_at',{ascending:false}).limit(50);
 return {conversations:data??[],error:error?'Conversation history unavailable. Apply migration 038 and retry.':null};
}
export async function openAssistantConversation(id:string){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(!uuidPattern.test(id))return {error:'Invalid conversation.'};
 const {data,error}=await supabase.from('assistant_conversations').select('id,title,messages,artist_ids,version').eq('workspace_id',workspace.id).eq('id',id).single();
 return error?{error:'Conversation unavailable or your access changed.'}:{conversation:data};
}
export async function persistAssistantConversation(workspaceId:string,id:string,version:number,title:string,messages:unknown,artists:string[]){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(workspace.id!==workspaceId||!uuidPattern.test(id)||!Number.isInteger(version)||!Array.isArray(messages)||messages.length>60||!Array.isArray(artists)||artists.length>5000||artists.some(a=>!uuidPattern.test(a)))return {error:'Invalid conversation or workspace changed.'};
 const {data,error}=await supabase.rpc('save_assistant_conversation',{w:workspace.id,i:id,v:version,t:title.slice(0,100),m:messages,artists});
 return error?{error:'Conversation could not be saved. Reload history before retrying; your answer is still shown here.'}:{version:data as number};
}
export async function executeAssistantTask(workspaceId:string,request:string,payload:unknown){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(workspace.id!==workspaceId||!uuidPattern.test(request))return {error:'Workspace changed. Review again.'};
 const {data,error}=await supabase.rpc('execute_assistant_task',{w:workspace.id,request,p:payload});
 return error?{error:error.code==='40001'?'Task changed since review. Ask Dopio for a fresh proposal.':'Task could not be saved. Check permission, dates and artist access. Nothing was saved by this attempt.'}:{id:data as string};
}

export async function executeAssistantRecord(workspaceId:string,request:string,payload:unknown){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(workspace.id!==workspaceId||!uuidPattern.test(request))return {error:'Workspace changed. Review again.'};
 const {data,error}=await supabase.rpc('execute_assistant_record',{w:workspace.id,request,p:payload});
 return error?{error:error.code==='40001'?'Record changed since review. Ask for a new proposal.':'Record could not be saved. Check access and reviewed details.'}:{id:data as string};
}
