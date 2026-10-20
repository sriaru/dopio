'use server';
import {requireUser,requireWorkspace} from '@/lib/auth/session';
import type {AssistantReceipt} from '@/lib/workspace/activity-feed';
export async function activityAssistantReceipts(expectedWorkspace:string){
 const {workspace}=await requireWorkspace();
 if(workspace.id!==expectedWorkspace)return {receipts:[] as AssistantReceipt[],error:'Workspace changed. Refresh Activity.'};
 const {supabase}=await requireUser();
 const {data,error}=await supabase.from('assistant_action_receipts').select('request_id,user_id,record_kind,record_id,created_at,payload').eq('workspace_id',workspace.id).order('created_at',{ascending:false}).limit(1000);
 return {receipts:(data??[]) as AssistantReceipt[],error:error?'Dopio action history could not be loaded. Refresh to retry.':data?.length===1000?'Showing the latest 1,000 accessible Dopio actions.':null};
}
