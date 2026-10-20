import "server-only";
import {cookies} from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const requireUser = cache(async () => {
  if (!isSupabaseConfigured()) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");
  return { supabase, user };
});
export const getAccount = cache(async () => {
  const { supabase, user } = await requireUser();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "full_name,role,company,artist_count,onboarding_step,onboarding_completed_at",
    )
    .eq("id", user.id)
    .maybeSingle();
  if (error) return { user, profile: null, workspace: null, setupError: true };
  const selected=(await cookies()).get("aura-workspace")?.value;
  let query = supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .order("created_at");
  if(selected)query=query.eq("workspace_id",selected);
  let {data:membership,error:membershipError}=await query.limit(1).maybeSingle();
  if(!membership&&selected){const fallback=await supabase.from("workspace_members").select("workspace_id").eq("user_id",user.id).order("created_at").limit(1).maybeSingle();membership=fallback.data;membershipError=fallback.error;}
  if (membershipError)
    return { user, profile, workspace: null, setupError: true };
  const { data: workspace, error: workspaceError } = membership
    ? await supabase
        .from("workspaces")
        .select("id,name,owner_id")
        .eq("id", membership.workspace_id)
        .single()
    : { data: null, error: null };
  return { user, profile, workspace, setupError: Boolean(workspaceError) };
});
export const requireWorkspace = cache(async () => {
  const account = await getAccount();
  if (
    account.setupError ||
    !account.profile?.onboarding_completed_at ||
    !account.workspace
  )
    redirect("/onboarding");
  return { ...account, profile: account.profile, workspace: account.workspace };
});
