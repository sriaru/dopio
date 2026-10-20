"use client";
import WorkspaceChat from './WorkspaceChat';
import {useSearchParams} from 'next/navigation';
import {releaseEmailReview} from '@/lib/ai/release-email';
import ReleaseRevisionPlanner from './ReleaseRevisionPlanner';
import type {WorkspaceData} from '@/lib/workspace/types';

export default function DopioPlannerWorkspace({data,workspace,name}:{data:WorkspaceData;workspace:string;name?:string}) {
 const params=useSearchParams();
 const source=data.email.messages.find(m=>m.id===params.get('emailReview'));
 const review=source?releaseEmailReview(source.body,data.releases.map(r=>({id:r.id,title:r.title,release_date:r.release_date,artist:data.artists.find(a=>a.record_id===r.artist_id)?.name??''})),data.tasks.filter(t=>t.status!=='Complete')):null;
 return <>
  {source&&review&&<details open>
   <summary>Review changes from {source.subject}</summary>
   <ReleaseRevisionPlanner key={source.id} data={data} initialRelease={review.releaseId} initialRequest={`Propose moving the release date to ${review.date}. Keep task dates unchanged; if any conflict, ask me how to handle them.`} sourceNote={`From imported email: ${source.subject}. Confirm that the album deadline refers to the release date before approving.`}/>
  </details>}
  <WorkspaceChat key={workspace} workspace={workspace} data={data} name={name}/>
 </>;
}
