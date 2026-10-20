import {workspaceDay} from "@/lib/workspace/rules";
import LiveWorkspace from "@/components/LiveWorkspace";
import { requireUser, requireWorkspace } from "@/lib/auth/session";
import { loadWorkspace } from "@/lib/workspace/data";
import { emptyWorkspace } from "@/lib/workspace/types";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; artist?: string; release?: string }>;
}) {
  const { user, profile, workspace } = await requireWorkspace();
  const {supabase}=await requireUser();
  const {data:workspaceRole}=await supabase.rpc("workspace_role",{p_workspace:workspace.id});
  const params = await searchParams;
  let data = emptyWorkspace;
  let loadError: string | null = null;
  try {
    data = await loadWorkspace(workspace.id);
  } catch (error) {
    loadError =
      error instanceof Error ? error.message : "Your workspace could not load.";
  }
  return (
    <LiveWorkspace
      key={`${user.id}:${workspace.id}:${params.view ?? ""}:${params.artist ?? ""}:${params.release ?? ""}`}
      account={{
        userId: user.id,
        workspaceRole: workspaceRole??"viewer",
        email: user.email ?? "",
        fullName: profile.full_name,
        role: profile.role,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      }}
      initialData={data}
      loadError={loadError}
      initialView={params.view}
      initialArtist={params.artist}
      initialRelease={params.release}
      today={data.today??workspaceDay()}
    />
  );
}
