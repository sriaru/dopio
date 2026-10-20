import { notFound, redirect } from "next/navigation";
import { requireWorkspace, requireUser } from "@/lib/auth/session";
import { uuidPattern } from "@/lib/workspace/validation";
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const { supabase } = await requireUser();
  if (!uuidPattern.test(id)) notFound();
  const { data } = await supabase
    .from("releases")
    .select("id")
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!data) notFound();
  redirect("/?view=Releases&release=" + encodeURIComponent(id));
}
