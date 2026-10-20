"use server";
import { revalidatePath } from "next/cache";
import { requireWorkspace, requireUser } from "@/lib/auth/session";
import { loadWorkspace } from "@/lib/workspace/data";
import {
  parseRecord,
  validateEntity,
  uuidPattern,
} from "@/lib/workspace/validation";
import type { Entity, MutationResult } from "@/lib/workspace/types";
const tables = {
  artist: "artists",
  release: "releases",
  task: "tasks",
} as const;
function dbError(code: string, entity: Entity) {
  if(code==="40001"||code==="PGRST116")return "This record changed. Refresh before trying again.";
  if (code === "23503" || code === "23001")
    return entity === "artist"
      ? "This artist has linked releases or tasks. Remove those first."
      : entity === "release"
        ? "Check the artist link. If this release has tasks, remove or unlink them before changing its artist or deleting it."
        : "Choose an artist and release from this workspace.";
  if (code === "23514" || code === "22P02")
    return "Please check the record details and dates.";
  if(code==="42501")return "Your workspace role cannot make this change.";
  return "The change could not be saved. Please try again.";
}
async function snapshot(workspaceId: string): Promise<MutationResult> {
  revalidatePath("/", "layout");
  try {
    return { error: null, data: await loadWorkspace(workspaceId) };
  } catch {
    return {
      error:
        "Your change was saved, but the updated records could not load. Refresh before trying again.",
    };
  }
}
export async function saveRecord(
  entity: Entity,
  id: string | null,
  form: FormData,
): Promise<MutationResult> {
  const { workspace } = await requireWorkspace();
  const { supabase } = await requireUser();
  let values: Record<string, string | null>;
  try {
    validateEntity(entity);
    if(id&&(!Number.isInteger(Number(form.get("version")))||Number(form.get("version"))<1))throw Error("Refresh before editing this record.");
    if (id && !uuidPattern.test(id)) throw Error("Invalid record.");
    values = parseRecord(entity, form);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Please check the form.",
    };
  }
  // Derive the artist for linked tasks on the server, never trust the client link.
  if (entity === "task" && values.release_id) {
    const { data: release, error } = await supabase
      .from("releases")
      .select("artist_id")
      .eq("id", values.release_id)
      .eq("workspace_id", workspace.id)
      .single();
    if (error || !release)
      return { error: "Choose a release from this workspace." };
    values.artist_id = release.artist_id;
  }
  const key = entity === "artist" ? "record_id" : "id";
  const query = id
    ? supabase
        .from(tables[entity])
        .update(values)
        .eq(key, id)
        .eq("version",Number(form.get("version")))
        .eq("workspace_id", workspace.id)
    : supabase
        .from(tables[entity])
        .insert({ ...values, workspace_id: workspace.id });
  const { error } = await query.select(key).single();
  if (error) return { error: dbError(error.code, entity) };
  return snapshot(workspace.id);
}
export async function deleteRecord(
  entity: Entity,
  id: string,
  version: number,
): Promise<MutationResult> {
  const { workspace } = await requireWorkspace();
  const { supabase } = await requireUser();
  try {
    validateEntity(entity);
    if (!uuidPattern.test(id)) throw Error("Invalid record.");
  } catch {
    return { error: "Invalid record." };
  }
  const {error}=await supabase.rpc("archive_workspace_record",{p_workspace:workspace.id,p_kind:entity,p_id:id,p_version:version,p_archive:true});
  if (error) return { error: dbError(error.code, entity) };
  return snapshot(workspace.id);
}
export async function setTaskComplete(
  id: string,
  complete: boolean,
  version: number,
): Promise<MutationResult> {
  const { workspace } = await requireWorkspace();
  const { supabase } = await requireUser();
  if (!uuidPattern.test(id) || typeof complete !== "boolean")
    return { error: "Invalid task." };
  const { error } = await supabase
    .from("tasks")
    .update({ status: complete ? "Complete" : "Pending" })
    .eq("version",version)
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .select("id")
    .single();
  if (error) return { error: dbError(error.code, "task") };
  return snapshot(workspace.id);
}
