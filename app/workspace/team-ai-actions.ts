'use server';
import {requireWorkspace,requireUser} from '@/lib/auth/session';
import {uuidPattern} from '@/lib/workspace/validation';
import {analyzeTeamMessages,type TeamTarget,type TeamSource} from '@/lib/ai/team-messages';
export async function teamMessageInsight(expectedWorkspace:string,artist:string,mode:'summary'|'actions'){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(workspace.id!==expectedWorkspace||!uuidPattern.test(artist)||!['summary','actions'].includes(mode))return {error:'Workspace changed. Reload this conversation.'};
 try{
 const {data:sources,error}=await supabase.rpc('artist_ai_messages',{w:workspace.id,a:artist,unread_only:mode==='summary'});
 if(error||!Array.isArray(sources))return {error:'Could not load authorized messages. Apply migration 037 and check artist access.'};
 if(!sources.length)return {error:mode==='summary'?'No unread messages to summarize.':'No messages to analyze.'};
 if(mode==='summary'&&sources.length>100)return {error:'More than 100 messages are available. Read older messages first or narrow this conversation before using AI.'};
 const settings=await supabase.from('workspaces').select('time_zone').eq('id',workspace.id).single();
 if(settings.error||!settings.data)return {error:'Could not load the workspace timezone. Try again.'};
 let targets:TeamTarget[]=[];
 if(mode==='actions'){
 const releases=await supabase.from('releases').select('id,title,release_date,version').eq('workspace_id',workspace.id).eq('artist_id',artist).is('archived_at',null).limit(201);
 const tasks=await supabase.from('tasks').select('id,title,due_date,version,release_id').eq('workspace_id',workspace.id).eq('artist_id',artist).is('archived_at',null).neq('status','Complete').limit(201);
 if(releases.error||tasks.error||!releases.data||!tasks.data||releases.data.length>200||tasks.data.length>200)return {error:'Could not load the artist’s current records, or there are too many to review together.'};
 targets=[...releases.data.map(r=>({id:r.id,title:r.title,kind:'release' as const,date:r.release_date,version:r.version,project:null,projectId:null})),...tasks.data.map(t=>({id:t.id,title:t.title,kind:'task' as const,date:t.due_date,version:t.version,projectId:t.release_id,project:releases.data.find(r=>r.id===t.release_id)?.title??null}))];
 }
 const key=process.env.OPENAI_API_KEY;if(!key)return {error:'AI is not configured on the server.'};
 const quota=await supabase.rpc('reserve_email_analysis',{p_workspace:workspace.id});if(quota.error||!quota.data)return {error:'AI usage limit reached or editor access required.'};
 const result=await analyzeTeamMessages(key,process.env.OPENAI_EMAIL_MODEL||'gpt-4o-mini',sources.slice(-100) as TeamSource[],mode==='actions'?targets:[],settings.data.time_zone,mode);
 const access=await supabase.rpc('can_access_artist',{w:workspace.id,a:artist});if(access.error||!access.data)return {error:'Artist access changed. This result is unavailable.'};
 return {result,targets:mode==='actions'?targets:[],sources:sources.slice(-100) as TeamSource[],timeZone:settings.data.time_zone};
 }catch{return {error:'AI could not produce a verified result. Nothing was changed. Try again.'};}
}
export async function reviewTeamMessage(w:string,a:string,source:number,kind:string,target:string,version:number,date:string,quote:string){
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(w!==workspace.id||!uuidPattern.test(a)||!uuidPattern.test(target)||!Number.isSafeInteger(source)||!Number.isInteger(version)||!['task','release'].includes(kind)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||typeof quote!=='string'||quote.length>2000)return {error:'Choose a saved record, confirm the full date and source quote.'};
 const {data,error}=await supabase.rpc('review_artist_message',{w,a,source_id:source,k:kind,target,expected:version,proposed:date,quote});
 return error?{error:'Review could not be saved. Check access or refresh changed records and try again.'}:{id:data as string};
}
