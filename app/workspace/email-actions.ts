"use server";
import {releaseEmailReview} from '@/lib/ai/release-email';
import { analyzeEmail, artistMention, evidenceDates, type Candidate } from "@/lib/ai/email-analysis";
import { revalidatePath } from "next/cache";
import { requireWorkspace, requireUser } from "@/lib/auth/session";
import { loadWorkspace } from "@/lib/workspace/data";
import { uuidPattern } from "@/lib/workspace/validation";
import type { MutationResult } from "@/lib/workspace/types";
function validDate(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "1900-01-01" ||
    value > "2199-12-31"
  )
    return false;
  const date = new Date(value + "T12:00:00Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
async function updated(workspaceId: string): Promise<MutationResult> {
  revalidatePath("/", "layout");
  try {
    return { error: null, data: await loadWorkspace(workspaceId) };
  } catch {
    return {
      error:
        "The change was saved, but the workspace could not refresh. Reload before retrying.",
    };
  }
}
export async function importSampleEmail(
  taskId: string,
  date: string,
): Promise<MutationResult> {
  const { workspace } = await requireWorkspace();
  const { supabase } = await requireUser();
  if (
    typeof taskId !== "string" ||
    !uuidPattern.test(taskId) ||
    typeof date !== "string" ||
    !validDate(date)
  )
    return { error: "Select a task and a valid new deadline." };
  const { data: task } = await supabase
    .from("tasks")
    .select("id,title,artist_id,release_id,status,due_date,version")
    .eq("workspace_id", workspace.id)
    .eq("id", taskId)
    .single();
  if (!task || !task.artist_id || task.status === "Complete")
    return { error: "Choose an open task linked to an artist." };
  if (task.due_date === date)
    return { error: "Choose a deadline different from the current date." };
  const { data: artist } = await supabase
    .from("artists")
    .select("name")
    .eq("workspace_id", workspace.id)
    .eq("record_id", task.artist_id)
    .single();
  const { data: release } = task.release_id
    ? await supabase
        .from("releases")
        .select("title")
        .eq("workspace_id", workspace.id)
        .eq("id", task.release_id)
        .single()
    : { data: null };
  if (!artist) return { error: "This task’s artist could not be loaded." };
  const body = `Hi team,\n\nWe need to adjust the deadline for ${task.title}. Please review the new date below.\n\nArtist: ${artist.name}\n${release ? `Release: ${release.title}\n` : ""}Task: ${task.title}\nNew deadline: ${date}\n\nThanks,\nAlex\n\n[Sample email created for testing, task revision ${task.version}. No message was sent or received through Gmail.]`;
  const { error } = await supabase.rpc("import_deadline_email", {
    p_workspace: workspace.id,
    p_source: "sample",
    p_sender: "Alex · sample sender",
    p_subject: `Deadline update: ${artist.name} — ${task.title}`,
    p_body: body,
  });
  if (error)
    return {
      error:
        "The sample could not be imported. Check that the email-workflow migration has been applied, then try again.",
    };
  return updated(workspace.id);
}
export async function importPastedEmail(
  form: FormData,
): Promise<MutationResult> {
  const { workspace } = await requireWorkspace();
  const sender = form.get("sender"),
    subject = form.get("subject"),
    body = form.get("body");
  if (
    typeof sender !== "string" ||
    !sender.trim() ||
    sender.length > 254 ||
    typeof subject !== "string" ||
    !subject.trim() ||
    subject.length > 200 ||
    typeof body !== "string" ||
    !body.trim() ||
    body.length > 20000
  )
    return {
      error: "Enter a sender, subject, and email body within the field limits.",
    };
  const {supabase}=await requireUser();
  const {data:id,error}=await supabase.rpc('import_ai_email',{p_workspace:workspace.id,p_sender:sender,p_subject:subject,p_body:body,p_task:null,p_version:null,p_date:null,p_evidence:'',p_note:'Saved source. Analyze or select the intended saved record to prepare a review.'});
  if(error||!id)return {error:'Could not save the email. Check your access and database migrations.'};
  // Persist the original before analysis so failures are recoverable from Inbox.
  const result=await analyzeGmailImport(id);
  if(result.error)return updated(workspace.id);
  return result;
}
export async function analyzeGmailImport(id: string): Promise<MutationResult> {
  const {workspace} = await requireWorkspace();
  const {supabase} = await requireUser();
  if (typeof id !== "string" || !uuidPattern.test(id)) return {error:"Choose a saved email."};
  const {data:message,error} = await supabase.from("inbox_messages").select("id,sender,subject,body,gmail_analysis_version").eq("workspace_id",workspace.id).eq("id",id).single();
  if(error || !message) return {error: error?.code === "42703" || error?.code === "PGRST204" ? "Apply migration 009 to analyze Gmail imports." : "This imported email could not be loaded. Check migration 009 and refresh."};
  const {data:proposal,error:proposalError} = await supabase.from("deadline_proposals").select("id").eq("workspace_id",workspace.id).eq("message_id",id).maybeSingle();
  if(proposalError) return {error:"Could not check existing proposals. Try again."};
  if(proposal) return updated(workspace.id);
  const {data:releaseProposal,error:releaseError}=await supabase.from('release_email_proposals').select('id').eq('workspace_id',workspace.id).eq('message_id',id).maybeSingle();
  if(releaseError)return {error:'Apply migration 031 to enable persistent release approvals, then refresh.'};
  if(releaseProposal)return updated(workspace.id);
  return analyzeAndSave(workspace.id,message,{id:message.id,revision:message.gmail_analysis_version});
}
async function analyzeAndSave(workspaceId: string, input: {sender:string;subject:string;body:string}, existing?: {id:string;revision:number}):Promise<MutationResult> {
  const {supabase} = await requireUser();
  const {sender,subject,body} = input;
  const key = process.env.OPENAI_API_KEY;
  try {
    const data = await loadWorkspace(workspaceId);
    const artists=data.artists.filter(a=>artistMention(body,a.name));
    const tasks=data.tasks.filter(t=>t.status!=='Complete'&&artists.some(a=>a.record_id===t.artist_id));
    const releaseReview=releaseEmailReview(body,data.releases.map(r=>({id:r.id,title:r.title,release_date:r.release_date,artist:data.artists.find(a=>a.record_id===r.artist_id)?.name??''})),tasks);
    if(existing && releaseReview){
      const release=data.releases.find(r=>r.id===releaseReview.releaseId)!;
      const {error}=await supabase.rpc('propose_email_release',{p_workspace:workspaceId,p_message:existing.id,p_release:release.id,p_version:release.version,p_date:releaseReview.date,p_evidence:releaseReview.evidence});
      if(error)return {error:error.code==='40001'?'Release changed. Refresh and analyze again.':'Could not save the release proposal. Apply migration 031 and check your access.'};
      return updated(workspaceId);
    }
    if(!tasks.length&&!releaseReview){
      if(!data.artists.length)return {error:'No artists are accessible in this workspace. Switch to the workspace containing this artist, or ask its owner to assign the artist to you, then analyze again.'};
      if(!artists.length)return {error:'This email does not match an artist you can access in the current workspace. Check Artists and your workspace selection. If the artist uses another name, choose the intended saved record below.'};
      const artistReleases=data.releases.filter(r=>artists.some(a=>a.record_id===r.artist_id));
      if(!artistReleases.length)return {error:'The artist is accessible, but no active project is saved for them in this workspace. Add the project in Projects, or switch to the workspace containing it, then analyze again.'};
      return {error:'No unique supported task or release match was found. Check the project title in Projects, then select the intended saved record below. Repeating Analyze with the same records will not resolve an ambiguous match.'};
    }
    if(tasks.length>100)return {error:'This email refers to artists with more than 100 open tasks. Use a more specific artist email or review the deadline manually.'};
  if (!key)
    return {
      error:
        "AI setup is needed: add OPENAI_API_KEY to .env.local on the server and restart Dopio. Sample imports still work.",
    };
    const candidates:Candidate[]=tasks.map(t=>({id:t.id,title:t.title,artist:artists.find(a=>a.record_id===t.artist_id)!.name,release:data.releases.find(r=>r.id===t.release_id)?.title??null,due_date:t.due_date,version:t.version!}));
    const {data:reserved,error:limitError}=await supabase.rpc('reserve_email_analysis',{p_workspace:workspaceId});
    if(limitError||!reserved)return {error:'AI allowance reached or your role cannot analyze emails. Check Company controls.'};
    const analysis = releaseReview?{task_id:null,deadline:null,evidence:'',explanation:releaseReview.explanation}:await analyzeEmail(
      { sender, subject, body },
      candidates,
      key,
      process.env.OPENAI_EMAIL_MODEL || "gpt-4o-mini",
    );
    const { error } = await supabase.rpc(existing ? "save_gmail_analysis" : "import_ai_email", {
      ...(existing ? { p_message: existing.id, p_revision: existing.revision } : { p_sender: sender, p_subject: subject, p_body: body }),
      p_workspace: workspaceId,

      p_task: analysis.task_id,
      p_version:
        candidates.find((t) => t.id === analysis.task_id)?.version ?? null,
      p_date: analysis.deadline,
      p_evidence: analysis.evidence,
      p_note: analysis.explanation,
    });
    if (error)
      return {
        error:
          "Analysis finished but could not be saved. Refresh your workspace and try again.",
      };
  } catch (error) {
    return {
      error:
        error instanceof Error && error.name !== "TimeoutError"
          ? error.message
          : "AI analysis timed out. No proposal was saved. Try again.",
    };
  }
  return updated(workspaceId);
}
export async function decideProposal(
  id: string,
  approve: boolean,
): Promise<MutationResult> {
  const { workspace } = await requireWorkspace();
  const { supabase } = await requireUser();
  if (
    typeof id !== "string" ||
    !uuidPattern.test(id) ||
    typeof approve !== "boolean"
  )
    return { error: "Invalid approval." };
  const {data:proposal,error:readError}=await supabase.from('deadline_proposals').select('id').eq('workspace_id',workspace.id).eq('id',id).single();
  if(readError||!proposal)return {error:'This proposal is unavailable in your active workspace.'};
  const { error } = await supabase.rpc("decide_deadline_proposal", {
    p_id: id,
    p_approve: approve,
  });
  if (error)
    return {
      error:
        "This approval could not be processed. Refresh and check that you still have access.",
    };
  return updated(workspace.id);
}

export async function decideReleaseEmail(id:string,approve:boolean):Promise<MutationResult>{
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(!uuidPattern.test(id)||typeof approve!=='boolean')return {error:'Invalid release approval.'};
 const {error}=await supabase.rpc('decide_email_release',{p_workspace:workspace.id,p_id:id,p_approve:approve});
 if(error)return {error:'Could not confirm the decision. Refresh before retrying; check your manager role and current access.'};
 return updated(workspace.id);
}

// Explicit resolution of ambiguous email identity; IDs must resolve through workspace RLS.
export async function selectEmailTarget(messageId:string,kind:string,targetId:string,date:string,evidence:string):Promise<MutationResult>{
 const {workspace}=await requireWorkspace();const {supabase}=await requireUser();
 if(!uuidPattern.test(messageId)||!uuidPattern.test(targetId)||!['task','release'].includes(kind)||!validDate(date)||typeof evidence!=='string'||!evidence.trim()||evidence.length>2000)return {error:'Choose a saved record, full date and source quote (up to 2,000 characters).'};
 const {data:m,error:me}=await supabase.from('inbox_messages').select('body,gmail_analysis_version').eq('workspace_id',workspace.id).eq('id',messageId).single();
 if(me||!m||!m.body.includes(evidence)||!evidenceDates(evidence).includes(date))return {error:'The exact source quote must contain the proposed full date and year. No proposal was saved.'};
 const data=await loadWorkspace(workspace.id);
 const target=kind==='task'?data.tasks.find(t=>t.id===targetId&&t.status!=='Complete'):data.releases.find(r=>r.id===targetId);
 if(!target)return {error:'The selected record is no longer accessible. Refresh and select again.'};
 const {error}=kind==='release'?await supabase.rpc('propose_email_release',{p_workspace:workspace.id,p_message:messageId,p_release:target.id,p_version:target.version,p_date:date,p_evidence:evidence}):await supabase.rpc('save_gmail_analysis',{p_workspace:workspace.id,p_message:messageId,p_revision:m.gmail_analysis_version,p_task:target.id,p_version:target.version,p_date:date,p_evidence:evidence,p_note:'Manager selected this saved task and source date. Review the exact change before approving.'});
 if(error)return {error:'Could not save the review. The record may have changed; refresh before trying again.'};
 return updated(workspace.id);
}
