export type InboxMessage = {
  id: string;
  workspace_id: string;
  source: "sample" | "manual" | "ai" | "gmail" | "team";
  sender: string;
  subject: string;
  body: string;
  analysis_status: "proposal" | "needs_context" | "no_change";
  analysis_note: string;
  created_at: string;
};
export type DeadlineProposal = {
  id: string;
  workspace_id: string;
  message_id: string;
  task_id: string | null;
  task_title: string;
  artist_name: string;
  release_title: string | null;
  previous_due_date: string | null;
  proposed_due_date: string;
  expected_version: number;
  evidence: string;
  status: "pending" | "approved" | "rejected" | "conflict";
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
};
export type EmailData = {
  releaseProposals?: ReleaseEmailProposal[];
  messages: InboxMessage[];
  proposals: DeadlineProposal[];
  available: boolean;
};
export const emptyEmailData: EmailData = {
  messages: [],
  proposals: [],
  available: false,
};

export type ReleaseEmailProposal = {
 id:string;message_id:string;release_id:string;release_title:string;artist_name:string;
 previous_date:string|null;proposed_date:string;expected_version:number;evidence:string;
 status:'pending'|'approved'|'rejected'|'conflict';result:string;created_at:string;decided_at:string|null;
};
