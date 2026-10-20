"use server";
import { requireWorkspace, requireUser } from "@/lib/auth/session";
import { uuidPattern } from "@/lib/workspace/validation";
export async function getArtistBrief(artist: string) {
  const { workspace } = await requireWorkspace();
  const { supabase } = await requireUser();
  if (!uuidPattern.test(artist))
    return { error: "Invalid artist.", brief: null };
  const { data, error } = await supabase
    .from("artist_briefs")
    .select("contacts,release_context,preferences,version,updated_at")
    .eq("workspace_id", workspace.id)
    .eq("artist_id", artist)
    .maybeSingle();
  return {
    error: error
      ? error.code === "PGRST205"
        ? "Run migration 007 in Supabase to enable artist briefs."
        : "Could not load the brief. Please retry."
      : null,
    brief: data,
  };
}
export async function saveArtistBrief(
  artist: string,
  version: number,
  form: FormData,
) {
  const { workspace } = await requireWorkspace();
  const { supabase } = await requireUser();
  const contacts = form.get("contacts"),
    context = form.get("release_context"),
    preferences = form.get("preferences");
  if (
    !uuidPattern.test(artist) ||
    !Number.isInteger(version) ||
    version < 0 ||
    [contacts, context, preferences].some(
      (v) => typeof v !== "string" || v.length > 5000,
    )
  )
    return {
      error: "Check the brief fields (maximum 5,000 characters each).",
      version,
    };
  const { data, error } = await supabase.rpc("save_artist_brief", {
    p_workspace: workspace.id,
    p_artist: artist,
    p_version: version,
    p_contacts: contacts,
    p_context: context,
    p_preferences: preferences,
  });
  return {
    error: error
      ? error.code === "40001"
        ? "Someone updated this brief. Copy your edits, then reload before saving."
        : "Could not save the brief. Check migration 007 and try again."
      : null,
    version: error ? version : Number(data),
  };
}
