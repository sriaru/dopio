"use server";
import {assertReceiptStorage,recordSend} from '@/lib/gmail/receipts';
import {randomUUID} from 'node:crypto';
import {requireUser,requireWorkspace} from '@/lib/auth/session';
import {uuidPattern} from '@/lib/workspace/validation';
import {gmailConfig} from '@/lib/gmail/config';
import {unseal} from '@/lib/gmail/security';
import {tokenRequest} from '@/lib/gmail/api';
import {encodeOutgoing} from '@/lib/gmail/outgoing';
export type ChatEmail={id:string;version:number;recipient:string;subject:string;body:string;status?:string};
export async function saveChatEmail(d:ChatEmail,expectedWorkspace:string){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(workspace.id!==expectedWorkspace||!d||!uuidPattern.test(d.id)||!Number.isInteger(d.version)||typeof d.recipient!=='string'||typeof d.subject!=='string'||typeof d.body!=='string')return {error:'Message or workspace changed.'};
 const {data,error}=await supabase.rpc('save_chat_message',{w:workspace.id,i:d.id,v:d.version,recipient:d.recipient,subject:d.subject,body:d.body});
 return {error:error?'Could not save. The message may have changed or been sent.':null,version:data as number};
}
export async function listChatEmails(){
 const {workspace,user}=await requireWorkspace();const {supabase}=await requireUser();
 const {data,error}=await supabase.from('chat_messages').select('id,recipient,subject,body,version,status').eq('workspace_id',workspace.id).eq('user_id',user.id).order('updated_at',{ascending:false}).limit(50);
 return {error:error?'Could not load your saved chat messages.':null,messages:(data??[]) as ChatEmail[]};
}
export async function sendChatEmail(d:ChatEmail,expectedWorkspace:string){
 const {workspace,user}=await requireWorkspace();const {supabase}=await requireUser();
 if(workspace.id!==expectedWorkspace)return {error:'Workspace changed. Reopen this message.'};
 let claimed=false;let outcome='unknown';const attempt=randomUUID();
 try{
 try{await assertReceiptStorage();}catch{return {error:'Sending is not configured. Ask the workspace administrator to configure server receipt storage and migration 034. Nothing was sent.'};}
 const {data:role}=await supabase.rpc('workspace_role',{p_workspace:workspace.id});if(!['owner','manager'].includes(role))return {error:'Owner or manager access is required to send.'};
 const {data:c,error}=await supabase.from('gmail_connections').select('*').eq('workspace_id',workspace.id).eq('user_id',user.id).single();
 if(error||!c?.can_send)return {error:'Connect your Gmail account with sending enabled first.'};
 const raw=encodeOutgoing(c.email,d.recipient,d.subject,d.body,attempt);const config=gmailConfig();
 const saved=await saveChatEmail(d,expectedWorkspace);if(saved.error)return saved;
 const refresh=unseal(c.encrypted_refresh_token,`gmail:${workspace.id}:${user.id}:${c.connection_id}:${c.email}`,config.key);
 const token=await tokenRequest({client_id:config.clientId,client_secret:config.clientSecret,grant_type:'refresh_token',refresh_token:refresh});
 const {data:ok,error:claimError}=await supabase.rpc('claim_chat_message',{w:workspace.id,i:d.id,v:saved.version,a:attempt});
 if(claimError||!ok)return {error:'This message changed or an identical send was already attempted. Reload your saved messages.'};
 claimed=true;
 const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({raw}),signal:AbortSignal.timeout(20000),cache:'no-store'});
 if(!response.ok){outcome=response.status>=400&&response.status<500?'rejected':'unknown';throw new Error();}const result=await response.json();if(typeof result.id!=='string'||!result.id.trim())throw new Error();
 const {error:finishError}=await recordSend('chat',workspace.id,user.id,attempt,result.id);
 if(finishError)return {error:'Google accepted the message, but confirmation could not be saved. Check Gmail Sent; do not resend.',locked:true};
 return {error:null,locked:true};
 }catch{if(claimed)await recordSend('chat',workspace.id,user.id,attempt,null,outcome).catch(()=>null);return {error:claimed&&outcome==='rejected'?'Google rejected this send. Check sending permissions and quota. This attempt is locked and was not retried.':claimed?'Send result uncertain. Check Gmail Sent; this message is locked.':'Could not complete sending. Reload saved messages before retrying.',locked:claimed};}
}
