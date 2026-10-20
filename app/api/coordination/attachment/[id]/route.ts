import {requireUser,requireWorkspace} from '@/lib/auth/session';
import {mailboxToken} from '@/lib/coordination/worker';
import {gmailGet} from '@/lib/gmail/api';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 const {data:d}=await supabase.from('coordination_deliverables').select('run_id,attachment').eq('id',id).single();
 if(!d?.attachment)return new Response('Unavailable',{status:404});
 const {data:run}=await supabase.from('coordination_runs').select('workspace_id,user_id,connection_id').eq('id',d.run_id).eq('workspace_id',workspace.id).single();
 if(!run||d.attachment.connection!==run.connection_id)return new Response('Original mailbox required',{status:403});
 try{
  const a=d.attachment;if(!a.id||!a.message||a.size<=0||a.size>25*1024*1024)throw new Error();
  const mailbox=await mailboxToken(supabase,run);
  const attachment=await gmailGet('messages/'+encodeURIComponent(a.message)+'/attachments/'+encodeURIComponent(a.id),mailbox.token);
  if(typeof attachment.data!=='string'||attachment.data.length>36*1024*1024)throw new Error();
  const bytes=Buffer.from(attachment.data,'base64url');if(bytes.length!==a.size)throw new Error();
  return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }catch{return new Response('Could not retrieve this attachment. Reconnect the original Gmail account and retry.',{status:502});}
}
