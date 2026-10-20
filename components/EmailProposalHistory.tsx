import {DEFAULT_TIME_ZONE} from '@/lib/workspace/rules';
import type {WorkspaceData} from '@/lib/workspace/types';
export default function EmailProposalHistory({data,id}:{data:WorkspaceData;id:string}){
 const rows=data.activity.filter(a=>a.entity_type==='proposal'&&a.entity_id===id);
 if(!rows.length)return null;
 return <details><summary>Recorded activity</summary><ul>{rows.map(a=><li key={a.id}>{new Date(a.created_at).toLocaleString('en-US',{timeZone:data.timeZone??DEFAULT_TIME_ZONE})} — {a.title} ({a.action})</li>)}</ul></details>;
}
