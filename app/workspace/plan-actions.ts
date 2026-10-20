"use server";
import { requireWorkspace, requireUser } from "@/lib/auth/session";
import { uuidPattern } from "@/lib/workspace/validation";
export async function approveReleasePlan(
  form: FormData,
): Promise<{ error: string | null; releaseId?: string }> {
  const { workspace } = await requireWorkspace();
  const { supabase } = await requireUser();
  const request = String(form.get("request") ?? ""),
    artist = String(form.get("artist") ?? "");
  const title = String(form.get("title") ?? "").trim(),
    date = String(form.get("date") ?? "");
  const format = String(form.get("format") ?? "Single");
  let tasks;
  try {
    tasks = JSON.parse(String(form.get("tasks")));
  } catch {
    return { error: "Check your task details." };
  }
  if (
    !["Single", "EP", "Album"].includes(format) ||
    !uuidPattern.test(request) ||
    !uuidPattern.test(artist) ||
    !title ||
    title.length > 200 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Array.isArray(tasks) ||
    tasks.length < 1 ||
    tasks.length > 20
  )
    return { error: "Choose an artist, title, release date, and 1–20 tasks." };
  const { data, error } = await supabase.rpc("create_release_plan_v2", {
    p_workspace: workspace.id,
    p_request: request,
    p_artist: artist,
    p_title: title,
    p_date: date,
    p_tasks: tasks,
    p_format: format,
  });
  if (error)
    return {
      error:
        error.code === "PGRST202"
          ? "Run migration 006 in Supabase to enable saving release plans."
          : "The plan could not be saved. Check your artist and dates; tasks must be due on or before release. No partial plan was saved.",
    };
  // The client performs a full navigation to fetch the saved release and tasks.
  return { error: null, releaseId: data };
}
