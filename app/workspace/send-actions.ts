"use server";
import {assertReceiptStorage,recordSend} from '@/lib/gmail/receipts';
import {randomUUID} from 'node:crypto';
import {requireWorkspace,requireUser} from '@/lib/auth/session';
import {gmailConfig} from '@/lib/gmail/config';
import {seal,unseal} from '@/lib/gmail/security';
import {tokenRequest} from '@/lib/gmail/api';
import {encodeOutgoing} from '@/lib/gmail/outgoing';
import {uuidPattern} from '@/lib/workspace/validation';
export async function reviewTaskEmail(id:string,version:number){
 const {workspace,user}=await requireWorkspace();const {supabase}=await requireUser();
 if(!uuidPattern.test(id) || !Number.isInteger(version))return {error:'Save and review a valid draft first.'};
 const {data:d}=await supabase.from('task_email_drafts').select('*').eq('workspace_id',workspace.id).eq('id',id).single();
 if(!d || d.version!==version)return {error:'Draft changed. Reload the saved draft before reviewing.'};
 const {data:sent,error:sendError}=await supabase.from('task_email_sends').select('status').eq('workspace_id',workspace.id).eq('draft_id',id).maybeSingle();
 if(sendError)return {error:'Run migration 014 before sending email.'};
 if(sent)return {error:sent.status==='sent'?'This draft was already sent.':'A send was already attempted. Check Gmail Sent before doing anything else; Dopio will not resend it.'};
 const {data:c}=await supabase.from('gmail_connections').select('email,connection_id,can_send').eq('workspace_id',workspace.id).eq('user_id',user.id).single();
 if(!c?.can_send)return {error:'Enable Gmail sending using the button below, then return to this saved draft.'};
 try{
 encodeOutgoing(c.email,d.recipient,d.subject,d.body,randomUUID());
 const ticket=seal(JSON.stringify({id,version,connection:c.connection_id,expires:Date.now()+600000}),`email-send:${workspace.id}:${user.id}`,gmailConfig().key);
 return {error:null,ticket,from:c.email,to:d.recipient,subject:d.subject,body:d.body};
 }catch{return {error:'Check the email addresses, subject, and Gmail configuration.'};}
}
export async function sendReviewedTaskEmail(ticket:string){
 const {workspace,user}=await requireWorkspace();const {supabase}=await requireUser();
 let claimed=false;let outcome='unknown';const attempt=randomUUID();
 try{
 try{await assertReceiptStorage();}catch{return {error:'Sending is not configured. Ask the workspace administrator to configure server receipt storage and migration 034. Nothing was sent.'};}
 const config=gmailConfig();
 if(typeof ticket!=='string' || ticket.length>10000)throw new Error();
 const p=JSON.parse(unseal(ticket,`email-send:${workspace.id}:${user.id}`,config.key));
 if(!Number.isFinite(p.expires) || p.expires<Date.now())return {error:'Review expired. Review the draft again.'};
 const {data:c}=await supabase.from('gmail_connections').select('*').eq('workspace_id',workspace.id).eq('user_id',user.id).eq('connection_id',p.connection).single();
 if(!c?.can_send)return {error:'Gmail connection changed. Review again after reconnecting.'};
 const {data:d}=await supabase.from('task_email_drafts').select('*').eq('workspace_id',workspace.id).eq('id',p.id).single();
 if(!d || d.version!==p.version)return {error:'Draft changed. Review it again.'};
 const raw=encodeOutgoing(c.email,d.recipient,d.subject,d.body,attempt);
 const refresh=unseal(c.encrypted_refresh_token,`gmail:${workspace.id}:${user.id}:${c.connection_id}:${c.email}`,config.key);
 const token=await tokenRequest({client_id:config.clientId,client_secret:config.clientSecret,grant_type:'refresh_token',refresh_token:refresh});
 const {data:ok,error}=await supabase.rpc('claim_task_email_send',{p_workspace:workspace.id,p_draft:p.id,p_version:p.version,p_connection:p.connection,p_attempt:attempt});
 if(error?.code==='40001')return {error:'The task, owner, project, or draft changed. Prepare a fresh draft and review it before sending.'};
 if(error || !ok)return {error:'This draft changed or a send was already attempted. Reload and check Gmail Sent. No additional message was sent.'};
 claimed=true;
 // Never automatically retry this non-idempotent external operation.
 const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({raw}),signal:AbortSignal.timeout(20000),cache:'no-store'});
 if(!response.ok){outcome=response.status>=400&&response.status<500?'rejected':'unknown';throw new Error();}
 const result=await response.json();if(typeof result.id!=='string'||!result.id.trim())throw new Error();
 const {error:saveError}=await recordSend('task',workspace.id,user.id,attempt,result.id);
 if(saveError)return {error:'Google accepted the email, but Dopio could not record confirmation. Check Gmail Sent. Do not resend.'};
 return {error:null};
 }catch{
 if(claimed)await recordSend('task',workspace.id,user.id,attempt,null,outcome).catch(()=>null);
 return {error:claimed&&outcome==='rejected'?'Google rejected this send. Check Gmail permissions and quota, then reconnect if needed. The attempt remains locked; it was not retried.':claimed?'The send result is uncertain. Check Gmail Sent. This draft is locked to prevent an accidental duplicate.':'Could not prepare sending. Reconnect Gmail or review the draft again. Nothing was sent.'};
 }
}

export async function reconcileTaskEmail(id:string){
 const {workspace,user}=await requireWorkspace();const {supabase}=await requireUser();
 if(!uuidPattern.test(id))return {error:'Choose a saved draft.'};
 try{
 const {data:send}=await supabase.from('task_email_sends').select('attempt_id,status,sender_email').eq('workspace_id',workspace.id).eq('actor_id',user.id).eq('draft_id',id).single();
 if(!send)return {error:'Only the teammate who attempted this send can check their Gmail confirmation.'};
 if(send.status==='sent')return {error:null};
 const {data:c}=await supabase.from('gmail_connections').select('*').eq('workspace_id',workspace.id).eq('user_id',user.id).single();
 if(!send.sender_email||c?.email!==send.sender_email||!c?.encrypted_refresh_token)return {error:'Reconnect the original sending account. Older attempts without an account record require checking Gmail Sent manually.'};
 const config=gmailConfig();const refresh=unseal(c.encrypted_refresh_token,`gmail:${workspace.id}:${user.id}:${c.connection_id}:${c.email}`,config.key);
 const token=await tokenRequest({client_id:config.clientId,client_secret:config.clientSecret,grant_type:'refresh_token',refresh_token:refresh});
 const {findSentAttempt}=await import('@/lib/gmail/reconcile');
 const provider=await findSentAttempt(token.access_token,send.attempt_id);
 if(!provider)return {error:'No unique sent-message confirmation found yet. The draft remains locked. Check Gmail Sent or retry this check later.'};
 const {error}=await recordSend('task',workspace.id,user.id,send.attempt_id,provider);
 return {error:error?'Gmail confirmed the message, but Dopio could not save the confirmation. Retry this check; do not resend.':null};
 }catch{return {error:'Could not check Gmail. Reconnect the sending account and retry. The draft remains locked.'};}
}
