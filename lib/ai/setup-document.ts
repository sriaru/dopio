import type {SetupProposal} from './setup-scan';
// Explicit roster boundaries are enforced before and after AI extraction.
export function documentRoster(notes:string,override=''):string[] {
 const lines=override.trim()?override.split(/\r?\n/):notes.split(/\r?\n/).flatMap(line=>{
  // Strip heading/list decoration only; never collect names from ordinary prose.
  const heading=line.trim().replace(/^(?:#{1,6}[ \t]+|[-*•][ \t]+|\d+[.)][ \t]+)/,'').replace(/\*\*/g,'');
  const match=heading.match(/^Artist(?:[ \t]+name|[ \t]+\d+)?[ \t]*[:：][ \t]*(.*)$/i);
  return match?[match[1]]:[];
 });
 const names=lines.map(n=>n.trim()).filter(Boolean);
 if(!names.length)throw new Error('Use an artist heading such as “Artist name: Luna Vale” or “Artist 1: Luna Vale”, or list your roster under “Using your own document format?”.');
 if(names.length>10||names.some(n=>n.length>100||/^\[.*\]$/.test(n)))throw new Error('List up to 10 actual artist names, one per line (100 characters each).');
 return [...new Map(names.map(n=>[n.toLowerCase(),n])).values()];
}
export const onboardingAIPrompt = `Complete the Dopio onboarding template below using information about artists I explicitly manage, available in this conversation or documents I provide. Use only history you can actually access. Do not treat collaborators, contacts, family members or people mentioned in passing as my artists. If my managed roster is unclear, ask me first.
Keep the exact "Artist name:" label for each managed artist. Include all their existing projects, outstanding tasks, known deadlines, team contacts, responsible people, priorities, preferences and decisions needing my approval. Repeat the artist and project sections as needed. Leave unknowns blank and flag conflicts. Do not invent dates, years, commitments or new work. Preserve uncertain date wording separately. Return plain text using the template so I can review it and paste it into Dopio.`;


function identityVariants(name:string):string[]{
 const full=name.trim().toLowerCase();
 const alias=full.match(/^(.+?)\s+\(([^()]+)\)$/);
 return alias?[full,alias[1].trim(),alias[2].trim()]:[full];
}

export function restrictDocumentRoster(proposal:SetupProposal,roster:string[],existing:{name:string}[]):SetupProposal {
 const saved=new Set(existing.flatMap(a=>identityVariants(a.name)));
 const eligible=roster.filter(name=>!identityVariants(name).some(n=>saved.has(n)));
 const seen=new Set<string>();
 const artists=proposal.artists.flatMap(a=>{
  const matches=eligible.filter(name=>identityVariants(name).includes(a.name.trim().toLowerCase()));
  // An ambiguous alias must never attach a proposal to the wrong artist.
  if(matches.length!==1||seen.has(matches[0].toLowerCase()))return [];
  const name=matches[0];seen.add(name.toLowerCase());
  return [{...a,name}];
 });
 const missing=eligible.filter(n=>!seen.has(n.toLowerCase()));
 const questions=[proposal.questions,missing.length?'No verified proposal for: '+missing.join(', ')+'. Check those artist sections in your brief.':''].filter(Boolean).join('\n\n').slice(0,2000);
 return {...proposal,artists,questions};
}

// The official template is structured input, so read it without model-generated quotes.
export function parseSetupTemplate(notes:string,roster:string[]):SetupProposal|null {
 const lines=notes.replace(/\r\n/g,'\n').split('\n');
 const headings=lines.flatMap((line,index)=>/^Artist name:[ \t]*\S/i.test(line.trim())?[index]:[]);
 if(!headings.length)return null;
 if(!headings.every(i=>lines.slice(0,i).filter(l=>l.trim()).at(-1)?.trim()==='ARTIST'))return null;
 const names=headings.map(i=>lines[i].trim().replace(/^Artist name:[ \t]*/i,''));
 if(roster.some(name=>!names.some(n=>n.toLowerCase()===name.toLowerCase())))return null;
 // Free-form briefs continue through the AI path; this parser handles the labeled template.
 if(!headings.every(i=>lines.slice(i,headings.find(j=>j>i)??lines.length).some(l=>/^Genre:/i.test(l.trim()))))return null;
 const warnings:string[]=[];
 const date=(raw:string,label:string)=>{
  if(!raw.trim())return '';
  const d=raw.trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>='1900-01-01'&&d<='2199-12-31'&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d)return d;
  warnings.push(label+': confirm the date in review; the original wording remains in your brief.');
  return '';
 };
 // Field values can continue on the next line, but never consume the next label.
 const fields=(block:string[])=>{
  const result=new Map<string,string>();let key='';
  for(const line of block){
   const match=line.trim().match(/^(?:-[ \t]*)?([^:]+):[ \t]*(.*)$/);
   if(match){key=match[1].trim().toLowerCase();result.set(key,match[2].trim());}
   else if(key&&line.trim()&&!/^(?:ARTIST|PROJECT|END ARTIST)$/i.test(line.trim()))result.set(key,(result.get(key)+'\n'+line.trim()).trim());
  }
  return result;
 };
 const global=lines.slice(0,headings[0]).join('\n').replace(/\nARTIST\s*$/,'').trim();
 const artists:SetupProposal['artists']=[];
 for(let n=0;n<headings.length;n++){
  const start=headings[n],end=headings[n+1]??lines.length;
  const name=names[n];if(!roster.some(r=>r.toLowerCase()===name.toLowerCase()))continue;
  if(artists.some(a=>a.name.toLowerCase()===name.toLowerCase()))return null;
  const block=lines.slice(start,end);
  const projectStarts=block.flatMap((line,index)=>line.trim()==='PROJECT'?[index]:[]);
  const profile=block.slice(0,projectStarts[0]??block.length);
  const info=fields(profile);
  const contacts=(info.get('team contacts (name, role, email)')||'').split('\n').flatMap(line=>{
   const parts=line.replace(/^[-•]\s*/,'').split(',').map(s=>s.trim());
   return parts.length===3&&parts[0]&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parts[2])?[{name:parts[0],role:parts[1],email:parts[2].toLowerCase()}]:[];
  }).slice(0,30);
  const releases:NonNullable<SetupProposal['artists'][number]['releases']>=[];
  const context=[global,profile.join('\n').replace(/\n(?:END ARTIST|ARTIST)\s*$/g,'').trim()];
  for(let pi=0;pi<projectStarts.length;pi++){
   const project=block.slice(projectStarts[pi]+1,projectStarts[pi+1]??block.length);
   const details=fields(project);
   const title=details.get('project title')??'';
   const format=[...details.entries()].find(([k])=>k==='type'||k.startsWith('type ('))?.[1]??'';
   const knownFormat=['Single','EP','Album','Tour','Campaign','Video','Partnership','Other'].find(f=>f.toLowerCase()===format.toLowerCase())??(/^live tour$/i.test(format)?'Tour':format.trim()?'Other':undefined);
   const quote=project.find(l=>/^Project title:/i.test(l.trim()))??'';
   if(!title.trim()){warnings.push(name+': a project needs a title and remains in the artist brief.');context.push(project.join('\n'));continue;}
   if(releases.length>=5){context.push(project.join('\n'));warnings.push(name+': only the first 5 releases are included. Review remaining projects in your original brief.');continue;}
   const taskStarts=project.flatMap((line,index)=>/^[ \t]*-[ \t]*Task:/i.test(line)?[index]:[]);
   const tasks:NonNullable<SetupProposal['artists'][number]['releases']>[number]['tasks']=[];
   const releaseDate=date(details.get('confirmed release date')??'',title);
   if(!releaseDate)warnings.push(title+': release date is unconfirmed. Timing: '+(details.get('unconfirmed date or timing notes')||'not supplied'));
   context.push(title+'\nStage: '+(details.get('current stage')||'unknown')+'\nTiming: '+(details.get('unconfirmed date or timing notes')||releaseDate||'unknown')+'\n'+(details.get('extra project context')||''));
   for(let ti=0;ti<taskStarts.length;ti++){
    const taskBlock=project.slice(taskStarts[ti],taskStarts[ti+1]??project.length);
    const t=fields(taskBlock);const taskTitle=t.get('task')||'';
    if(!taskTitle.trim())continue;
    if(tasks.length>=20){warnings.push(title+': only the first 20 tasks are included. Review remaining tasks in your original brief.');break;}
    let due=date(t.get('confirmed deadline')??'',taskTitle);
    if(['Single','EP','Album'].includes(knownFormat??'')&&(t.get('current status')||'').toLowerCase()!=='complete'&&releaseDate&&due>releaseDate){warnings.push(taskTitle+': deadline is after release; confirm it in review.');due='';}
    // Only the task's own lines form its evidence; later project notes are separate.
    const extra=taskBlock.findIndex(l=>/^Extra project context:|^END ARTIST$|^ARTIST$/i.test(l.trim()));
    const evidence=taskBlock.slice(0,extra<0?taskBlock.length:extra).join('\n').trim().slice(0,1500);
    const owners=contacts.filter(c=>c.name.toLowerCase()===(t.get('responsible person')||'').toLowerCase());
    tasks.push({title:taskTitle,due_date:due,source_id:'document',evidence,timing:(t.get('unconfirmed deadline wording')||'').slice(0,1000),status:['Pending','In progress','Complete'].find(s=>s.toLowerCase()===(t.get('current status')||'').toLowerCase())||'Pending',owner_email:owners.length===1?owners[0].email:''});
    context.push(taskTitle+': '+(t.get('unconfirmed deadline wording')||due||'date unknown')+'; owner: '+(t.get('responsible person')||'unassigned')+'; status: '+(t.get('current status')||'unknown'));
   }
   if(tasks.some(t=>!t.due_date))warnings.push(title+': tasks with unconfirmed deadlines remain undated. Target dates and responsibilities appear in task evidence and the brief.');
   releases.push({timing:(details.get('unconfirmed date or timing notes')||'').slice(0,1000),title,format:knownFormat??'',date:releaseDate,source_id:'document',evidence:quote.trim(),tasks});
  }
  const fullContext=context.join('\n\n');
  if(fullContext.length>2500)warnings.push(name+': the brief exceeds the saved context limit. Review the shortened brief and keep your original document for full details.');
  artists.push({contacts,name,genre:info.get('genre')||'',context:fullContext.slice(0,2500),source_id:'document',evidence:lines[start].trim(),releases});
 }
 return {artists,questions:[...new Set(warnings)].join('\n\n').slice(0,2000)};
}
