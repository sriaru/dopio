import 'server-only';
import {createClient} from '@supabase/supabase-js';
import {gmailConfig} from '@/lib/gmail/config';
import {unseal} from '@/lib/gmail/security';
import {gmailGet,tokenRequest} from '@/lib/gmail/api';
import {findSentAttempt} from '@/lib/gmail/reconcile';
import {analyzeSource} from './analysis';
import {attachmentMatches,type Context,type Deliverable} from './model';
import {readSource,encodeReply} from './gmail';
export function coordinationClient(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new Error('Coordination server storage is not configured');
 // Background access is fenced by the lease, original mailbox and current membership
 // checks in the service-only RPCs. Never expose this client to a browser.
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
type DB=ReturnType<typeof coordinationClient>;
export type Run={id:string;workspace_id:string;user_id:string;release_id:string;connection_id:string;senders:string[];demo:boolean;lease:string;page_token:string|null};
async function rpc(db:DB,name:string,args:Record<string,unknown>={}){const r=await db.rpc(name,args);if(r.error)throw new Error('Workflow state changed or unavailable');return r.data;}
export async function mailboxToken(db:DB,run:Pick<Run,'workspace_id'|'user_id'|'connection_id'>){
 const {data:c,error}=await db.from('gmail_connections').select('email,encrypted_refresh_token,can_send').eq('workspace_id',run.workspace_id).eq('user_id',run.user_id).eq('connection_id',run.connection_id).single();
 if(error||!c)throw new Error('Reconnect the original Gmail account');
 const config=gmailConfig();
 const refresh=unseal(c.encrypted_refresh_token,`gmail:${run.workspace_id}:${run.user_id}:${run.connection_id}:${c.email}`,config.key);
 const token=await tokenRequest({client_id:config.clientId,client_secret:config.clientSecret,grant_type:'refresh_token',refresh_token:refresh});
 return {...c,token:token.access_token};
}
async function contexts(db:DB,run:Run):Promise<Context[]>{
 const {data:member,error:memberError}=await db.from('workspace_members').select('role').eq('workspace_id',run.workspace_id).eq('user_id',run.user_id).single();
 if(memberError||!member||!['owner','manager'].includes(member.role))throw new Error('Access changed');
 const {data:assignments,error:accessError}=await db.from('artist_access').select('artist_id').eq('workspace_id',run.workspace_id).eq('user_id',run.user_id);
 if(accessError)throw new Error('Access unavailable');
 let query=db.from('releases').select('id,artist_id,title,release_date').eq('workspace_id',run.workspace_id).is('archived_at',null).limit(51);
 if(member.role!=='owner')query=query.in('artist_id',(assignments??[]).map(a=>a.artist_id));
 const {data:projects,error}=await query;if(error||!projects||projects.length>50)throw new Error('Project context unavailable or exceeds 50 projects');
 const {data:artists,error:artistError}=await db.from('artists').select('record_id,name').eq('workspace_id',run.workspace_id).in('record_id',projects.map(p=>p.artist_id));
 const {data:deliverables,error:dError}=await db.from('coordination_deliverables').select('id,task_id,title,due_date,extensions,status').eq('run_id',run.id).limit(101);
 if(dError||artistError||!deliverables||deliverables.length>100)throw new Error('Deliverable context unavailable or exceeds 100 items');
 const {data:tasks,error:tError}=await db.from('tasks').select('id,title,due_date,status').eq('workspace_id',run.workspace_id).eq('release_id',run.release_id).is('archived_at',null).limit(101);
 if(tError||!tasks)throw new Error('Task context unavailable');
 const current=deliverables.flatMap(d=>{const task=tasks.find(t=>t.id===d.task_id&&t.status!=='Complete');return task?[{...d,title:task.title,due_date:task.due_date} as Deliverable]:[];});
 return projects.map(p=>({id:p.id,title:p.title,artist:artists?.find(a=>a.record_id===p.artist_id)?.name??'',release_date:p.release_date,deliverables:p.id===run.release_id?current:[]}));
}
export async function processRun(db:DB,run:Run){
 let next=run.page_token;const deadline=Date.now()+160000;
 const budget=()=>{if(Date.now()>deadline)throw new Error('Batch pending');};
 try{
  const mailbox=await mailboxToken(db,run),projects=await contexts(db,run);
  if(!projects.some(p=>p.id===run.release_id))throw new Error('Project access changed');
  const allowedDemo=(process.env.COORDINATION_DEMO_EMAILS??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  if(run.demo&&(!allowedDemo.includes(mailbox.email.toLowerCase())||run.senders.some(s=>!allowedDemo.includes(s))))throw new Error('Demo addresses must be explicitly allowed on the server');
  const processed=new Set<string>();let count=0;
  async function ingest(id:string){
   budget();
   if(processed.has(id))return;processed.add(id);
   const {data:existing,error}=await db.from('coordination_observations').select('id').eq('run_id',run.id).eq('provider_id',id).maybeSingle();
   if(error)throw new Error('Observation storage unavailable');if(existing)return;
   // Bound execution, leave the page cursor unchanged to resume safely next tick.
   const source=await readSource(id,mailbox.token);
   if(!run.senders.includes(source.sender)||source.sender===mailbox.email.toLowerCase())return;
   if(++count>2)throw new Error('Batch pending');
   const {data:history,error:historyError}=await db.from('coordination_observations').select('source').eq('run_id',run.id).eq('source->>thread',source.thread).order('created_at',{ascending:false}).limit(3);
   if(historyError)throw new Error('Thread evidence unavailable');
   const finding=await analyzeSource(source,projects,(history??[]).map(h=>({sender:h.source.sender,received:h.source.received,body:String(h.source.body).slice(0,4000)})));
   const deliverable=projects.find(p=>p.id===finding.project_id)?.deliverables.find(d=>d.id===finding.deliverable_id);
   const verified_candidates=source.attachments.filter(a=>finding.attachment_ids.includes(a.id)&&attachmentMatches(a,deliverable?.extensions??[]));
   await rpc(db,'commit_coordination',{i:run.id,l:run.lease,s:source,f:{...finding,verified_candidates}});
  }
  // Poll tracked threads before dispatch so a received answer invalidates queued drafts.
  const {data:actions,error:aError}=await db.from('coordination_actions').select('*').eq('run_id',run.id).in('status',['approved','sent','sending','unknown']).order('created_at').limit(31);
  if(aError||!actions||actions.length>30)throw new Error('Too many tracked actions; review the queue');
  for(const thread of new Set(actions.map(a=>String(a.thread_id)))){
   const result=await gmailGet('threads/'+encodeURIComponent(thread)+'?format=minimal',mailbox.token);
   for(const m of result.messages??[])await ingest(m.id);
  }
  const q='newer_than:30d -in:spam -in:trash {'+run.senders.map(s=>'from:'+s).join(' ')+'}';
  let page;
  try{page=await gmailGet('messages?'+new URLSearchParams({q,maxResults:'2',...(run.page_token?{pageToken:run.page_token}:{})}),mailbox.token);}
  catch{if(!run.page_token)throw new Error('Gmail scan failed');page=await gmailGet('messages?'+new URLSearchParams({q,maxResults:'2'}),mailbox.token);}
  for(const m of page.messages??[])await ingest(m.id);
  next=page.nextPageToken??null;
  await rpc(db,'prepare_coordination_followups',{i:run.id,l:run.lease});
  for(const action of actions){
   budget();
   if(['sending','unknown'].includes(action.status)){
    const provider=await findSentAttempt(mailbox.token,action.attempt_id);
    if(provider)await rpc(db,'record_coordination_send',{a:action.id,attempt:action.attempt_id,provider});
    continue;
   }
   if(action.status!=='approved'||!mailbox.can_send)continue;
   // Validate the MIME envelope before the irreversible claim.
   encodeReply(mailbox.email,action.recipient,action.subject,action.body,action.id,action.message_id);
   const claimed=await rpc(db,'claim_coordination_send',{i:run.id,l:run.lease,a:action.id});
   if(!claimed?.id)continue;
   let provider:string|null=null;
   try{
    const raw=encodeReply(mailbox.email,claimed.recipient,claimed.subject,claimed.body,claimed.attempt_id,claimed.message_id);
    const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${mailbox.token}`,'Content-Type':'application/json'},body:JSON.stringify({raw,threadId:claimed.thread_id}),cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(response.ok){const sent=await response.json();if(typeof sent.id==='string'&&sent.id)provider=sent.id;}
   }finally{
    await rpc(db,'record_coordination_send',{a:claimed.id,attempt:claimed.attempt_id,provider});
   }
   break; // At most one external send per lease.
  }
  await rpc(db,'finish_coordination',{i:run.id,l:run.lease,token:next,problem:null});
  return {ok:true};
 }catch(error){
  if(error instanceof Error&&error.message==='Batch pending'){await rpc(db,'finish_coordination',{i:run.id,l:run.lease,token:run.page_token,problem:null});return {ok:true,pending:true};}
  await rpc(db,'finish_coordination',{i:run.id,l:run.lease,token:run.page_token,problem:'Processing paused. Check Gmail connection, AI quota, demo allowlist and project access. The batch will retry; uncertain sends are never retried.'});
  return {ok:false};
 }
}
export async function tickCoordination(){
 const db=coordinationClient();const runs=await rpc(db,'claim_coordination') as Run[];
 if(!runs?.length)return {processed:0};
 const result=await processRun(db,runs[0]);return {processed:1,...result};
}
