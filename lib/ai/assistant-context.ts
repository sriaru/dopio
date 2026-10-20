import type {SupabaseClient} from '@supabase/supabase-js';
export type Source={key:string;label:string;href:string;record:Record<string,unknown>};
const specs:readonly (readonly [string,string,string,string])[]=[
 ['artists','record_id,name,genre,status,version','record_id','Artists'],
 ['releases','id,artist_id,title,format,release_date,status,notes,version','id','Releases'],
 ['tasks','id,artist_id,release_id,title,due_date,status,notes,version','id','Tasks'],
 ['artist_briefs','artist_id,contacts,release_context,preferences,version','artist_id','Artists'],
 ['workspace_contacts','id,name,email,role','id','Owners'],
 ['inbox_messages','id,subject,sender,body,source,created_at','id','Inbox'],
 ['deadline_proposals','id,task_id,task_title,previous_due_date,proposed_due_date,status,decision_note,created_at','id','Approvals'],
 ['release_email_proposals','id,release_id,release_title,previous_date,proposed_date,status,result,created_at','id','Approvals'],
 ['workspace_activity','id,entity_type,entity_id,action,title,created_at','id','Activity'],
 ['artist_updates','id,artist_id,kind,body,previous_date,new_date,created_at','id','Messages'],
] as const;
export function rankSources(sources:Source[],question:string,limit=100,today=new Date().toISOString().slice(0,10)){
 const words=[...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[])].filter(w=>!['the','and','what','about','with','this','that','please','could','should'].includes(w));
 const changes=/changed|changes|recent|this week|activity/i.test(question),attention=/overdue|outstanding|attention|resolve/i.test(question),approvals=/approval|decision|pending/i.test(question);
 return sources.map((source,index)=>{
  const r=source.record;let score=words.reduce((score,w)=>score+(JSON.stringify(r).toLowerCase().includes(w)?2:0),0);
  if(changes&&/^(workspace_activity|artist_updates):/.test(source.key))score+=12;
  if(attention&&source.key.startsWith('tasks:')&&r.status!=='Complete'&&r.due_date&&String(r.due_date)<today)score+=12;
  if((attention||approvals)&&/^(deadline_proposals|release_email_proposals):/.test(source.key)&&r.status==='pending')score+=12;
  return {source,index,score};
 }).sort((a,b)=>b.score-a.score||(changes?String(b.source.record.created_at??'').localeCompare(String(a.source.record.created_at??'')):0)||a.index-b.index).slice(0,limit).map(x=>x.source);
}
export async function retrieveAssistantContext(client:SupabaseClient,workspace:string,user:string,question:string,today?:string){
 const records:Record<string,Record<string,unknown>[]>={};const warnings:string[]=[];
 await Promise.all(specs.map(async([table,fields,key])=>{
  const rows:Record<string,unknown>[]=[];
  for(let offset=0;offset<5000;offset+=500){
   const recent=['inbox_messages','workspace_activity','artist_updates','deadline_proposals','release_email_proposals'].includes(table);
   let q=client.from(table).select(fields).eq('workspace_id',workspace).order(recent?'created_at':key,{ascending:!recent}).order(key).range(offset,offset+499);
   if(['artists','releases','tasks'].includes(table))q=q.is('archived_at',null);
   // Personal email content stays personal even when the owner can administer imports.
   if(table==='inbox_messages')q=q.eq('imported_by',user);
   // Team chat is excluded: this assistant never silently reads team conversations.
   if(table==='artist_updates')q=q.neq('kind','message');
   const result=await q;
   if(result.error){warnings.push(`${table} could not be retrieved. Do not infer its contents.`);break;}
   rows.push(...(result.data as unknown as Record<string,unknown>[]));
   if(result.data.length<500)break;
   if(offset===4500)warnings.push(`${table}: retrieval limited to 5000 accessible records.`);
  }
  records[table]=rows;
 }));
 const teams=await client.rpc('task_managers',{p_workspace:workspace});
 if(teams.error)warnings.push('Assigned manager names unavailable.');
 else for(const task of records.tasks??[])task.managers=(teams.data??[]).find((t:{task_id:string})=>t.task_id===task.id)?.manager_names??[];
 const artists=new Map((records.artists??[]).map(a=>[a.record_id,a]));const projects=new Map((records.releases??[]).map(r=>[r.id,r]));
 for(const rows of Object.values(records))for(const row of rows){
  const project=projects.get(row.release_id);const artist=artists.get(row.artist_id??project?.artist_id);
  if(artist)row.artist_name=artist.name;if(project)row.project_title=project.title;
 }
 const all:Source[]=specs.flatMap(([table,,key,view])=>(records[table]??[]).map(record=>({
  key:`${table}:${record[key]}`,label:String(record.name??record.title??record.subject??record.task_title??record.release_title??table.replaceAll('_',' ')),
  href:table==='artists'||table==='artist_briefs'?`/artists/${record[key]}`:table==='releases'?`/projects/${record[key]}`:`/?view=${view}${table==='tasks'?`#task-${record[key]}`:table==='inbox_messages'?`#message-${record[key]}`:table==='artist_updates'?`&artist=${record.artist_id}`:''}`,
  record,
 })));
 let budget=100000;
 const selected=rankSources(all,question,100,today).flatMap(source=>{
  const record=Object.fromEntries(Object.entries(source.record).map(([k,v])=>[k,typeof v==='string'&&v.length>4000?v.slice(0,4000)+' [excerpt truncated]':v]));
  const size=JSON.stringify(record).length;if(size>budget)return [];budget-=size;return [{...source,record}];
 });
 return {records,sources:selected,warnings:[...warnings,`Retrieved ${all.length} accessible records; selected ${selected.length} for this answer, with excerpts capped at 4000 characters and a 100000-character record budget. Imported emails may not include the latest Gmail messages. Calendar data requires the explicit connected-calendar option.`]};
}
