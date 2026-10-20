import 'server-only';
import {createClient} from '@supabase/supabase-js';
// Never use this client to select user content. User-scoped clients authorize and
// claim attempts first; only provider receipts use this restricted RPC.
export function receiptClient(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new Error('Server receipt storage is not configured.');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function recordSend(kind:'task'|'chat',workspace:string,actor:string,attempt:string,provider:string|null,outcome='unknown'){
 return receiptClient().rpc('record_google_send_result',{p_kind:kind,p_workspace:workspace,p_actor:actor,p_attempt:attempt,p_provider:provider,p_outcome:provider?'accepted':outcome});
}

export async function assertReceiptStorage(){
 const {data,error}=await receiptClient().rpc('google_receipts_ready');
 if(error||data!==true)throw new Error('Apply migration 034 and configure server receipt storage.');
}
