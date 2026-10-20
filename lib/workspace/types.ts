import { emptyEmailData, type EmailData } from "./email-types";
export type Account = {
  workspaceRole?: string;
  userId: string;
  email: string;
  fullName: string;
  role: string;
  workspaceId: string;
  workspaceName: string;
};
export type ArtistRecord = {
  record_id: string;
  name: string;
  genre: string | null;
  status: "Active" | "On Hold";
  workspace_id: string;
  created_at: string;
  version?: number;
  archived_at?: string | null;
};
export type ReleaseRecord = {
  id: string;
  workspace_id: string;
  artist_id: string;
  title: string;
  format: "Single" | "EP" | "Album" | "Tour" | "Campaign" | "Video" | "Partnership" | "Other";
  release_date: string | null;
  status: "Planning" | "On track" | "At risk" | "Released";
  notes: string;
  timing_notes?: string;
  created_at: string;
  version?: number;
  archived_at?: string | null;
};
export type TaskRecord = {
  manager_names?: string[];
  id: string;
  workspace_id: string;
  artist_id: string | null;
  release_id: string | null;
  title: string;
  due_date: string | null;
  status: "Pending" | "In progress" | "Complete";
  priority: "Normal" | "High";
  notes: string;
  timing_notes?: string;
  created_at: string;
  version?: number;
  archived_at?: string | null;
};
export type ActivityRecord = {
  previous_data?: Record<string,unknown>|null;
  current_data?: Record<string,unknown>|null;
  id: string;
  workspace_id: string;
  actor_id: string | null;
  entity_type: "artist" | "release" | "task" | "email" | "proposal" | "contact";
  entity_id: string;
  action:
    | "created"
    | "updated"
    | "deleted"
    | "imported"
    | "approved"
    | "rejected"
    | "conflict";
  title: string;
  created_at: string;
  version?: number;
  archived_at?: string | null;
};
export type WorkspaceData = {
  workspaceId?: string;
  timeZone?: string;
  today?: string;
  artists: ArtistRecord[];
  releases: ReleaseRecord[];
  tasks: TaskRecord[];
  activity: ActivityRecord[];
  email: EmailData;
};
export type Entity = "artist" | "release" | "task";
export type MutationResult =
  { error: string; data?: never } | { error: null; data: WorkspaceData };
export const emptyWorkspace: WorkspaceData = {
  artists: [],
  releases: [],
  tasks: [],
  activity: [],
  email: emptyEmailData,
};
