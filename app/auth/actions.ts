"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";

export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw new Error("Sign out failed. Please try again.");
  revalidatePath("/", "layout");
  redirect("/login");
}
export async function saveProfile(fullName: string) {
  const name = fullName.trim();
  if (!name || name.length > 100)
    return { error: "Enter a name between 1 and 100 characters." };
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("profiles")
    .update({ full_name: name })
    .eq("id", user.id)
    .select("id")
    .single();
  if (error || !data)
    return { error: "Your profile could not be saved. Please try again." };
  revalidatePath("/", "layout");
  return { error: null };
}
export async function saveOnboarding(input: {
  fullName: string;
  role: string;
  company: string;
  artistCount: string;
  workspaceName: string;
  complete: boolean;
}) {
  const name = input.fullName.trim();
  const workspaceName = input.workspaceName.trim();
  if (
    !name ||
    name.length > 100 ||
    !workspaceName ||
    workspaceName.length > 100 ||
    input.company.length > 150 ||
    ![
      "Artist Manager",
      "Publicist",
      "Label Team",
      "Independent Artist",
    ].includes(input.role) ||
    !["1–2", "3–5", "6–10", "11+"].includes(input.artistCount)
  )
    return { error: "Please check your name, role, and workspace details." };
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("save_workspace_onboarding", {
    p_full_name: name,
    p_role: input.role,
    p_company: input.company.trim(),
    p_artist_count: input.artistCount,
    p_workspace_name: workspaceName,
    p_complete: input.complete,
  });
  if (error) {
    console.error("Workspace onboarding failed:", error.code);
    return {
      error:
        "We couldn’t save your workspace. Please try again. If this continues, the workspace database may need its setup migration.",
    };
  }
  revalidatePath("/", "layout");
  return { error: null };
}
