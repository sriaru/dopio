export type Attachment = {id:string;filename:string;mime:string;size:number};
export type Source = {id:string;thread:string;messageId:string;sender:string;subject:string;body:string;received:string;attachments:Attachment[]};
export type Deliverable = {id:string;title:string;due_date:string|null;extensions:string[];status:string};
export type Context = {id:string;artist:string;title:string;release_date:string|null;deliverables:Deliverable[]};
export type Finding = {project_id:string|null;deliverable_id:string|null;confidence:number;kind:'unrelated'|'ambiguous'|'delay'|'commitment'|'received'|'question';promised_date:string|null;evidence:string;summary:string;consequence:string;severity:'low'|'medium'|'high';steps:string[];draft:string;attachment_ids:string[]};
const nullable={type:['string','null']};
export const findingSchema={type:'object',additionalProperties:false,properties:{project_id:nullable,deliverable_id:nullable,confidence:{type:'number'},kind:{type:'string',enum:['unrelated','ambiguous','delay','commitment','received','question']},promised_date:nullable,evidence:{type:'string'},summary:{type:'string'},consequence:{type:'string'},severity:{type:'string',enum:['low','medium','high']},steps:{type:'array',items:{type:'string'}},draft:{type:'string'},attachment_ids:{type:'array',items:{type:'string'}}},required:['project_id','deliverable_id','confidence','kind','promised_date','evidence','summary','consequence','severity','steps','draft','attachment_ids']};
export function validateFinding(value:unknown,source:Source,contexts:Context[]):Finding {
 if(!value||typeof value!=='object')throw new Error('Invalid analysis');
 const p=value as Finding;
 if(!['unrelated','ambiguous','delay','commitment','received','question'].includes(p.kind)||!['low','medium','high'].includes(p.severity)||!Number.isFinite(p.confidence)||p.confidence<0||p.confidence>1)throw new Error('Invalid analysis');
 for(const key of ['evidence','summary','consequence','draft'] as const)if(typeof p[key]!=='string'||p[key].length>(key==='draft'?6000:2000))throw new Error('Invalid analysis');
 if(!Array.isArray(p.steps)||p.steps.length>8||p.steps.some(s=>typeof s!=='string'||s.length>500)||!Array.isArray(p.attachment_ids)||p.attachment_ids.length>20||p.attachment_ids.some(id=>!source.attachments.some(a=>a.id===id)))throw new Error('Invalid evidence');
 const project=contexts.find(c=>c.id===p.project_id),item=project?.deliverables.find(d=>d.id===p.deliverable_id);
 if(p.promised_date!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(p.promised_date)||!Number.isFinite(Date.parse(p.promised_date))||new Date(p.promised_date).toISOString().slice(0,10)!==p.promised_date))throw new Error('Invalid date');
 if(p.kind!=='unrelated'&&(!p.evidence.trim()||!source.body.includes(p.evidence)))throw new Error('Exact source evidence required');
 if(p.kind==='unrelated')return {...p,project_id:null,deliverable_id:null,attachment_ids:[]};
 if(!project||!item||p.confidence<0.85)return {...p,kind:'ambiguous',project_id:null,deliverable_id:null,attachment_ids:[],draft:''};
 return p;
}
export function deadlineConflict(due:string|null,promised:string|null){return !!due&&!!promised&&promised>due;}
export function attachmentMatches(a:Attachment,extensions:string[]){
 const ext=a.filename.split('.').pop()?.toLowerCase();
 const types:Record<string,string[]>={wav:['audio/wav','audio/x-wav','audio/vnd.wave'],mp3:['audio/mpeg'],flac:['audio/flac','audio/x-flac'],pdf:['application/pdf'],png:['image/png'],jpg:['image/jpeg'],jpeg:['image/jpeg']};
 return !!ext&&extensions.includes(ext)&&!!types[ext]?.includes(a.mime.toLowerCase())&&a.size>0&&a.size<=25*1024*1024&&!/[\x00-\x1f/\\]/.test(a.filename);
}
export function replyMatches(source:Source,action:{thread_id:string;recipient:string;sent_at:string|null}){
 return !!action.sent_at&&source.thread===action.thread_id&&source.sender.toLowerCase()===action.recipient.toLowerCase()&&source.received>action.sent_at;
}
export function normalizeAddress(raw:string){
 const address=(raw.match(/<([^<>]+)>/)?.[1]??raw).trim().toLowerCase();
 if(address.length>254||!/^[-a-z0-9.!#$%&'*+/=?^_`{|}~]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(address))throw new Error('Single sender address required');
 return address;
}
