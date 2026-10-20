export type RevisionTask = { id: string; title: string; due_date: string | null };
export type Revision = { title: string; format: string; date: string; tasks: RevisionTask[]; question: string };
export type RevisionSnapshot = {
 release: { title: string; format: string; date: string | null; artist_id: string };
 tasks: (RevisionTask & { version: number })[];
};
function date(value: string) {
 return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && value <= '2199-12-31' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
}
export function validateRevision(value: unknown, snapshot: RevisionSnapshot): Revision {
 if (!value || typeof value!=='object') throw new Error('Invalid revision');
 const p=value as Revision;
 if (typeof p.question!=='string' || p.question.length>1000 || typeof p.title!=='string' || !p.title.trim() || p.title.length>150 || !['Single','EP','Album'].includes(p.format) || !date(p.date)) throw new Error('Check the release details and full date.');
 if (!Array.isArray(p.tasks) || p.tasks.length>20 || p.tasks.length!==snapshot.tasks.length || new Set(p.tasks.map(t=>t?.id)).size!==p.tasks.length) throw new Error('The revision must retain every open task.');
 for (const task of p.tasks) {
  if (!task || !snapshot.tasks.some(t=>t.id===task.id) || typeof task.title!=='string' || !task.title.trim() || task.title.length>150 || (task.due_date!==null && (!date(task.due_date) || task.due_date>p.date))) throw new Error('Check task identities and deadlines.');
 }
 return p;
}
export const revisionSchema = {
 type:'object',additionalProperties:false,
 properties:{title:{type:'string'},format:{type:'string',enum:['Single','EP','Album']},date:{type:'string'},question:{type:'string'},
 tasks:{type:'array',items:{type:'object',additionalProperties:false,properties:{id:{type:'string'},title:{type:'string'},due_date:{type:['string','null']}},required:['id','title','due_date']}}},
 required:['title','format','date','question','tasks'],
};
