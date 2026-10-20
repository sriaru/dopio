import type {Source} from './assistant-context';
export type ToolProposal={kind:'create_task'|'update_task'|'revise_release'|'calendar_sync'|'create_artist'|'update_artist'|'update_brief'|'update_project_notes';target_id:string|null;artist_id:string|null;release_id:string|null;title:string|null;date:string|null;status:string|null;notes:string|null;request_text:string};
export type ReviewedTool=ToolProposal&{request:string;version?:number;artist_version?:number;release_version?:number|null;before?:Record<string,unknown>;conflicts:string[]};
const nullable={type:['string','null']};
export const toolSchema={type:'array',items:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['create_task','update_task','revise_release','calendar_sync','create_artist','update_artist','update_brief','update_project_notes']},target_id:nullable,artist_id:nullable,release_id:nullable,title:nullable,date:nullable,status:nullable,notes:nullable,request_text:{type:'string'}},required:['kind','target_id','artist_id','release_id','title','date','status','notes','request_text']}};
export function validateCitations(keys:unknown,sources:Source[]):Source[]{
 if(!Array.isArray(keys)||keys.length>20||keys.some(k=>typeof k!=='string'||!sources.some(s=>s.key===k)))throw new Error('Unsupported source citation');
 return [...new Set(keys)].map(k=>sources.find(s=>s.key===k)!);
}
export function prepareTools(value:unknown,records:Record<string,Record<string,unknown>[]>,requestId:()=>string):ReviewedTool[]{
 if(!Array.isArray(value)||value.length>6)throw new Error('Too many actions');
 return value.map((p:ToolProposal)=>{
  if(!p||!['create_task','update_task','revise_release','calendar_sync','create_artist','update_artist','update_brief','update_project_notes'].includes(p.kind)||typeof p.request_text!=='string'||p.request_text.length>2000)throw new Error('Unsupported action');
  if(['create_artist','update_artist','update_brief','update_project_notes'].includes(p.kind)){
   const artist=records.artists.find(a=>a.record_id===p.target_id);
   const before=p.kind==='update_project_notes'?records.releases.find(r=>r.id===p.target_id):p.kind==='update_brief'?(records.artist_briefs??[]).find(b=>b.artist_id===p.target_id):artist;
   if(p.kind!=='create_artist'&&(!before&&p.kind!=='update_brief'||p.kind==='update_brief'&&!artist))throw new Error('Record unavailable');
   const title=p.title??String(before?.name??before?.title??artist?.name??'');
   const notes=p.notes??String(before?.release_context??before?.notes??'');
   const status=p.status??String(artist?.status??'Active');
   if(typeof title!=='string'||!title.trim()||(['create_artist','update_artist'].includes(p.kind)&&title.length>100)||typeof notes!=='string'||notes.length>5000||!['Active','On Hold'].includes(status))throw new Error('Invalid record details');
   return {...p,title,notes,status,version:Number(before?.version??0),before,request:requestId(),conflicts:[]};
  }
  const task=records.tasks.find(t=>t.id===p.target_id);const release=records.releases.find(r=>r.id===(p.kind==='revise_release'||p.kind==='calendar_sync'?p.target_id:p.release_id));
  if(p.kind==='revise_release'||p.kind==='calendar_sync'){
   if(!release)throw new Error('Project unavailable');
   return {...p,request:requestId(),before:release,conflicts:[]};
  }
  if(p.kind==='update_task'&&!task)throw new Error('Task unavailable');
  const artist=records.artists.find(a=>a.record_id===(task?.artist_id??p.artist_id));
  if(!artist||p.kind==='create_task'&&p.release_id&&(!release||release.artist_id!==artist.record_id))throw new Error('Artist or project unavailable');
  const title=p.title??task?.title;const date=p.date??task?.due_date??null;const requestedStatus=p.status??task?.status??'Pending';const status=requestedStatus==='Inactive'?'Pending':requestedStatus==='Completed'?'Complete':requestedStatus;const notes=p.notes??task?.notes??'';
  if(typeof title!=='string'||!title.trim()||title.length>150||typeof notes!=='string'||notes.length>5000||!['Pending','In progress','Complete'].includes(String(status)))throw new Error('Invalid task');
  if(date!==null&&(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw new Error('Invalid date');
  const project=records.releases.find(r=>r.id===(task?.release_id??p.release_id));
  const conflicts=project&&date&&status!=='Complete'&&['Single','EP','Album'].includes(String(project.format))&&project.release_date&&date>String(project.release_date)?['Deadline is after the release date. Review the release schedule first.']:[];
  return {...p,title,date:date as string|null,status:String(status),notes,artist_id:String(artist.record_id),release_id:(task?.release_id??p.release_id) as string|null,version:task?Number(task.version):undefined,artist_version:Number(artist.version),release_version:project?Number(project.version):null,request:requestId(),before:task,conflicts};
 });
}
