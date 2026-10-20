import { notFound, redirect } from "next/navigation";
import { requireWorkspace, requireUser } from "@/lib/auth/session";
export default async function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const { supabase } = await requireUser();
  // Legacy URLs use the original id; new links use record_id. Both remain scoped.
  let recordId: string | null = null;
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const { data } = await supabase
      .from("artists")
      .select("record_id")
      .eq("record_id", id)
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    recordId = data?.record_id ?? null;
  }
  if (!recordId) {
    const { data } = await supabase
      .from("artists")
      .select("record_id")
      .eq("id", id)
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    recordId = data?.record_id ?? null;
  }
  if (!recordId) notFound();
  redirect("/?view=Artists&artist=" + encodeURIComponent(recordId));
}
