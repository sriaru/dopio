"use server";
import {randomUUID} from 'node:crypto';
import {requireWorkspace,requireUser} from '@/lib/auth/session';
import {documentRoster,restrictDocumentRoster,parseSetupTemplate} from '@/lib/ai/setup-document';
import {setupInstructions,setupSchema,validateSetup,reviewSetupResponse,type SetupSource,type SetupProposal,type SetupArtist,type SetupRelease} from '@/lib/ai/setup-scan';
import {seal,unseal,encryptionKey} from '@/lib/gmail/security';
import {loadWorkspace} from '@/lib/workspace/data';

type ScanTicket={workspace:string;user:string;request:string;expires:number;proposal:SetupProposal};
export async function scanWorkspaceSetup(form:FormData):Promise<{error?:string;proposal?:SetupProposal;ticket?:string;sources?:{id:string;label:string}[]}> {
 const {workspace,user}=await requireWorkspace();const {supabase}=await requireUser();
 let stage="input";
 try {
  const notes=String(form.get('notes')||'').replace(/\r\n/g,'\n');
  if(!notes.trim()||notes.length>30000)return {error:'Add your completed brief (up to 30,000 characters).'};
  let roster:string[];
  try{roster=documentRoster(notes,String(form.get('roster')||''));}catch(error){return {error:error instanceof Error?error.message:'Check your artist names.'};}
  const sources:SetupSource[]=[{id:'document',label:'Your artist brief',text:notes}];
  stage="configuration";
  const encryption=encryptionKey(process.env.GMAIL_TOKEN_ENCRYPTION_KEY);
  stage="workspace";
  const {data:artists,error}=await supabase.from('artists').select('name').eq('workspace_id',workspace.id).limit(1001);
  if(error||!artists||artists.length>1000)return {error:'Could not load the current artist roster.'};
  if(roster.every(name=>artists.some(a=>a.name.trim().toLowerCase()===name.toLowerCase())))return {error:'These artists are already in your workspace. Open Artists or Releases to update their existing records.'};
  let parsed=parseSetupTemplate(notes,roster);
  if(parsed===null){
   const key=process.env.OPENAI_API_KEY;if(!key)return {error:'Configure the AI API key for custom-format briefs, or use the labeled template.'};
  const {data:allowed,error:limit}=await supabase.rpc('reserve_email_analysis',{p_workspace:workspace.id});if(limit||!allowed)return {error:'AI allowance reached. Wait a minute or check the monthly cap in Company controls.'};
  stage="provider";
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(45000),body:JSON.stringify({model:process.env.OPENAI_EMAIL_MODEL||'gpt-4o-mini',store:false,max_output_tokens:7000,
   instructions:setupInstructions,
   input:JSON.stringify({sources,managed_roster:roster,existing_artists:artists}),text:{format:{type:'json_schema',name:'setup_artists',strict:true,schema:setupSchema}}})});
  if(!response.ok)return {error:response.status===429?'AI quota or rate limit reached. Check credits or try again later.':'AI could not scan these sources. Try again.'};
  stage="response";
  const result=await response.json();
  parsed=reviewSetupResponse(result,sources);
  }
  const proposal=restrictDocumentRoster(validateSetup(parsed,sources,true),roster,artists);
  stage="review";
  const ticket=seal(JSON.stringify({workspace:workspace.id,user:user.id,request:randomUUID(),expires:Date.now()+3600000,proposal} satisfies ScanTicket),'setup-review',encryption);
  return {proposal,ticket,sources:sources.map(({id,label})=>({id,label}))};
 }catch(error){
  const reason=error instanceof Error?error.message:'';
  if(stage==='configuration')return {error:'Setup review encryption is not configured. Check GMAIL_TOKEN_ENCRYPTION_KEY on the server and restart Dopio.'};
  if(error instanceof Error && ['TimeoutError','AbortError'].includes(error.name))return {error:'The AI scan timed out. Try a shorter brief. Nothing was created.'};
  if(stage==='provider')return {error:'Could not reach the AI service. Please retry. Nothing was created.'};
  if(stage==='response')return {error:reason==='refusal'?'AI declined to analyze these sources. Edit your brief; nothing was created.':reason==='incomplete'?'AI stopped before completing the scan. Try a shorter brief; nothing was created.':'AI returned an unreadable scan response. Retry the scan; nothing was created.'};
  if(stage==='workspace')return {error:'Could not check your workspace or scan allowance. Refresh and try again.'};
  if(stage==='review')return {error:'The scan finished, but its review could not be prepared. Retry; nothing was created.'};
  return {error:'The brief could not be read. Check its text and try again. Nothing was created.'};
 }
}
export async function approveWorkspaceSetup(ticket:string,selected:{index:number;name:string;genre:string;context:string;releases:{index:number;value:SetupRelease}[]}[]){
 const {workspace,user}=await requireWorkspace();const {supabase}=await requireUser();
 let saved:ScanTicket;let artists:SetupArtist[];
 try{
  if(typeof ticket!=='string'||ticket.length>150000)throw new Error();
  saved=JSON.parse(unseal(ticket,'setup-review',encryptionKey(process.env.GMAIL_TOKEN_ENCRYPTION_KEY)));
  if(saved.workspace!==workspace.id||saved.user!==user.id||saved.expires<Date.now()||!Array.isArray(selected)||!selected.length||selected.length>10||new Set(selected.map(s=>s.index)).size!==selected.length)throw new Error();
  artists=selected.map(s=>{
   const original=saved.proposal.artists[s.index];
   if(!Number.isInteger(s.index)||!original||!Array.isArray(s.releases)||s.releases.length>5||new Set(s.releases.map(r=>r.index)).size!==s.releases.length)throw new Error();
   const releases=s.releases.map(r=>{if(!Number.isInteger(r.index))throw new Error();return reviewedRelease(original.releases?.[r.index],r.value);});
   return {...original,name:s.name,genre:s.genre,context:s.context,release:null,releases};
  });
  validateSetup({artists,questions:''});
 }catch{return {error:'This review expired or is invalid. Scan again before approving.'};}
 const {error}=await supabase.rpc('approve_setup_document_v2',{p_workspace:workspace.id,p_request:saved.request,p_artists:artists});
 if(error)return {error:error.code==='PGRST202'?'Run migrations 020–022 in Supabase after 019.':error.code==='23505'?'One of these artists already exists. Exclude it from the review and try again.':'Could not save the approved artists. Nothing was partially created.'};
 try{return {data:await loadWorkspace(workspace.id)};}catch{return {error:'Save succeeded but refresh failed. Reload the page to see your artists.'};}
}

function reviewedRelease(original:SetupRelease|null|undefined,edited:SetupRelease|null|undefined):SetupRelease {
 if(!original||!edited||!Array.isArray(edited.tasks)||edited.tasks.length!==original.tasks.length)throw new Error('Invalid release review');
 return {...original,title:edited.title,format:edited.format,date:edited.date,timing:edited.timing,tasks:original.tasks.map((task,i)=>({...task,title:edited.tasks[i].title,due_date:edited.tasks[i].due_date,timing:edited.tasks[i].timing,status:edited.tasks[i].status,owner_email:edited.tasks[i].owner_email}))};
}

export async function loadOnboardingDraft(){
 const {workspace,user}=await requireWorkspace();const {supabase}=await requireUser();
 const {data,error}=await supabase.from('onboarding_drafts').select('notes,roster,version,updated_at').eq('workspace_id',workspace.id).eq('user_id',user.id).maybeSingle();
 return {data,error:error?'Could not load the saved brief. Apply migration 023 first.':null};
}
export async function saveOnboardingDraft(version:number,notes:string,roster:string){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(!Number.isInteger(version)||version<0||typeof notes!=='string'||notes.length>30000||typeof roster!=='string'||roster.length>1010)return {error:'Check the brief length.',version};
 const {data,error}=await supabase.rpc('save_onboarding_draft',{p_workspace:workspace.id,p_version:version,p_notes:notes,p_roster:roster});
 return {version:data as number,error:error?.code==='40001'?'A saved brief already exists or changed in another tab. Load it before overwriting.':error?'Could not save the brief. Apply migration 023 first.':null};
}
