import type { InboxMessage, DeadlineProposal, ReleaseEmailProposal } from "./email-types";
import "server-only";
import {activeRecords,workspaceDay} from "./rules";
import { createClient } from "@/lib/supabase/server";
import type {
  WorkspaceData,
  ArtistRecord,
  ReleaseRecord,
  TaskRecord,
  ActivityRecord,
} from "./types";
export async function loadWorkspace(
  workspaceId: string,
): Promise<WorkspaceData> {
  const supabase = await createClient();
  const {error:privacyError}=await supabase.rpc("can_access_artist",{w:workspaceId,a:null});
  if(privacyError)throw new Error("Apply migration 026 before opening workspace records. Artist privacy controls are not installed yet.");
  const {data:settings,error:settingsError}=await supabase.from('workspaces').select('time_zone').eq('id',workspaceId).single();
  if(settingsError||!settings)throw new Error('Could not load workspace timezone. Apply migration 033 and refresh.');
  const managers = await supabase.rpc("task_managers", {p_workspace:workspaceId});
  if(managers.error)throw new Error("Apply migration 028 to load task manager assignments.");
  const managerNames = new Map<string,string[]>((managers.data as {task_id:string;manager_names:string[]}[]).map(row=>[row.task_id,row.manager_names]));
  let emailAvailable = true;
  async function rows<T>(
    table: string,
    columns: string,
    optional = false,
  ): Promise<T[]> {
    const result: T[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from(table)
        .select(columns)
        .eq("workspace_id", workspaceId)
        .order(table === "workspace_activity" ? "sequence" : "created_at", {
          ascending: false,
        })
        .order(table === "artists" ? "record_id" : "id")
        .range(offset, offset + 999);
      if (error && optional && error.code === "PGRST205") {
        emailAvailable = false;
        return [];
      }
      if (error)
        throw new Error(
          error.code === "PGRST205" || error.code === "42703"
            ? "The workspace database update is needed before records can load."
            : "We couldn’t load your workspace. Please try again.",
        );
      result.push(...(data as unknown as T[]));
      if (data.length < 1000) return result;
    }
  }
  const [artists, releases, tasks, activity, messages, proposals, releaseProposals] =
    await Promise.all([
      rows<ArtistRecord>(
        "artists",
        "record_id,name,genre,status,workspace_id,created_at,version,archived_at",
      ),
      rows<ReleaseRecord>(
        "releases",
        "id,workspace_id,artist_id,title,format,release_date,status,timing_notes,notes,created_at,version,archived_at",
      ),
      rows<TaskRecord>(
        "tasks",
        "id,workspace_id,artist_id,release_id,title,due_date,status,priority,timing_notes,notes,created_at,version,archived_at",
      ),
      rows<ActivityRecord>(
        "workspace_activity",
        "id,workspace_id,actor_id,entity_type,entity_id,action,title,created_at,previous_data,current_data",
      ),
      rows<InboxMessage>(
        "inbox_messages",
        "id,workspace_id,source,sender,subject,body,analysis_status,analysis_note,created_at",
        true,
      ),
      rows<DeadlineProposal>(
        "deadline_proposals",
        "id,workspace_id,message_id,task_id,task_title,artist_name,release_title,previous_due_date,proposed_due_date,expected_version,evidence,status,decided_by,decided_at,decision_note,created_at",
        true,
      ),
      rows<ReleaseEmailProposal>("release_email_proposals","id,message_id,release_id,release_title,artist_name,previous_date,proposed_date,expected_version,evidence,status,result,created_at,decided_at"),
    ]);
  return {
    workspaceId,
    ...activeRecords(artists,releases,tasks.map(t=>({...t,manager_names:managerNames.get(t.id)??[]}))),
    timeZone:settings.time_zone,
    today:workspaceDay(new Date(),settings.time_zone),
    activity,
    email: { messages, proposals, releaseProposals, available: emailAvailable },
  };
}
