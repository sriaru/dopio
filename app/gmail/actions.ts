"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireWorkspace, requireUser } from "@/lib/auth/session";
import { gmailConfig } from "@/lib/gmail/config";
import {
  authorizationURL,
  newPendingOAuth,
  seal,
  unseal,
} from "@/lib/gmail/security";
import {
  gmailGet,
  tokenRequest,
  summarizeMessage,
  messageText,
  type GmailMessage,
  type GmailSummary,
} from "@/lib/gmail/api";
import { loadWorkspace } from "@/lib/workspace/data";
import type { WorkspaceData } from "@/lib/workspace/types";
const context = (workspace: string, user: string, id: string, email: string) =>
  `gmail:${workspace}:${user}:${id}:${email}`;
function safeError(error: unknown) {
  return error instanceof Error &&
    error.name !== "TimeoutError" &&
    error.name !== "TypeError"
    ? error.message
    : "Could not reach Gmail. Try again shortly.";
}
export async function gmailStatus(): Promise<{
  configured: boolean;
  email: string | null;
  connectionId: string | null;
  error: string | null;
}> {
  const { workspace, user } = await requireWorkspace();
  const { supabase } = await requireUser();
  let configured = true;
  try {
    gmailConfig();
  } catch {
    configured = false;
  }
  const { data, error } = await supabase
    .from("gmail_connections")
    .select("email,connection_id")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .maybeSingle();
  return {
    configured,
    email: data?.email ?? null,
    connectionId: data?.connection_id ?? null,
    error: error
      ? "Apply migration 008 in Supabase, then reload Gmail status."
      : !configured
        ? "Gmail needs Google OAuth credentials and an encryption key. See docs/GMAIL_SETUP.md."
        : null,
  };
}
export async function startGmailConnection(sendAccess = false, setup = false): Promise<{ error: string }> {
  const { workspace, user } = await requireWorkspace();
  const { supabase } = await requireUser();
  let target: string;
  try {
    const config = gmailConfig();
    const origin = (await headers()).get("origin");
    if (origin !== config.origin)
      return { error: `Open Dopio at ${config.origin} to connect Gmail.` };
    const { error } = await supabase
      .from("gmail_connections")
      .select("connection_id")
      .eq("workspace_id", workspace.id)
      .eq("user_id", user.id)
      .limit(1);
    if (error) return { error: "Apply migration 008 before connecting Gmail." };
    const pending = newPendingOAuth(user.id, workspace.id);
    if (setup === true) pending.returnTo = "/get-started";
    (await cookies()).set(
      "aura-gmail-oauth",
      seal(JSON.stringify(pending), "gmail-oauth", config.key),
      {
        httpOnly: true,
        secure: config.origin.startsWith("https:"),
        sameSite: "lax",
        path: "/gmail",
        maxAge: 600,
      },
    );
    target = authorizationURL(pending, config.clientId, config.redirectUri);
    if (sendAccess === true) {
      const url = new URL(target);
      url.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send");
      target = url.toString();
    }
  } catch {
    return {
      error:
        "Gmail setup is incomplete. Follow docs/GMAIL_SETUP.md, then retry.",
    };
  }
  redirect(target);
}
async function currentConnection(expected?: string) {
  const { workspace, user } = await requireWorkspace();
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("gmail_connections")
    .select("connection_id,email,encrypted_refresh_token")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) throw new Error("Connect Gmail before loading messages.");
  if (expected && data.connection_id !== expected)
    throw new Error("Your Gmail connection changed. Reload the email list.");
  const config = gmailConfig();
  let refresh: string;
  try {
    refresh = unseal(
      data.encrypted_refresh_token,
      context(workspace.id, user.id, data.connection_id, data.email),
      config.key,
    );
  } catch {
    throw new Error(
      "Gmail credentials could not be opened. Disconnect and reconnect Gmail.",
    );
  }
  return { workspace, user, supabase, connection: data, config, refresh };
}
export async function listGmailMessages(
  expected: string,
): Promise<{ error: string | null; messages: GmailSummary[] }> {
  // Authorize before the catch so an expired Dopio session keeps its redirect behavior.
  await requireWorkspace();
  try {
    const c = await currentConnection(expected);
    const token = await tokenRequest({
      client_id: c.config.clientId,
      client_secret: c.config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: c.refresh,
    });
    const list = await gmailGet(
      "messages?maxResults=10&q=in%3Ainbox%20newer_than%3A30d",
      token.access_token,
    );
    const settled = await Promise.allSettled(
      (list.messages ?? []).slice(0, 10).map(async (m: { id: string }) => {
        const message = (await gmailGet(
          `messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
          token.access_token,
        )) as GmailMessage;
        return summarizeMessage(message);
      }),
    );
    const messages: GmailSummary[] = settled.flatMap(
      (r: PromiseSettledResult<GmailSummary>) =>
        r.status === "fulfilled" ? [r.value] : [],
    );
    return {
      error: settled.some(
        (r: PromiseSettledResult<GmailSummary>) => r.status === "rejected",
      )
        ? "Some messages could not be loaded. Reload to try again."
        : null,
      messages,
    };
  } catch (e) {
    return { error: safeError(e), messages: [] };
  }
}
export async function importGmailMessage(
  id: string,
  expected: string,
): Promise<{ error: string | null; data?: WorkspaceData }> {
  await requireWorkspace();
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(id))
    return { error: "Invalid Gmail message." };
  try {
    const c = await currentConnection(expected);
    const token = await tokenRequest({
      client_id: c.config.clientId,
      client_secret: c.config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: c.refresh,
    });
    const raw = (await gmailGet(
      `messages/${encodeURIComponent(id)}?format=full`,
      token.access_token,
    )) as GmailMessage;
    const summary = summarizeMessage(raw),
      body = messageText(raw);
    const { error } = await c.supabase.rpc("import_gmail_message", {
      p_workspace: c.workspace.id,
      p_connection: c.connection.connection_id,
      p_message_id: id,
      p_sender: summary.sender,
      p_subject: summary.subject,
      p_body: body,
      p_received: summary.received,
    });
    if (error)
      return {
        error:
          "The email could not be saved. Check migration 008 and reload your Gmail connection. No tasks were changed.",
      };
    try {
      return { error: null, data: await loadWorkspace(c.workspace.id) };
    } catch {
      return {
        error:
          "Email saved, but the workspace could not refresh. Refresh the page. Importing the same email again will not duplicate it.",
      };
    }
  } catch (e) {
    return { error: safeError(e) };
  }
}
export async function disconnectGmail(
  expected: string,
): Promise<{ error: string | null; disconnected: boolean }> {
  const { workspace, user } = await requireWorkspace();
  const { supabase } = await requireUser();
  const { data: row, error: readError } = await supabase
    .from("gmail_connections")
    .select("connection_id,email,encrypted_refresh_token")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .eq("connection_id", expected)
    .maybeSingle();
  if (readError)
    return {
      error: "Could not load the connection. Please retry.",
      disconnected: false,
    };
  if (!row) return { error: null, disconnected: true };
  // Remove local credentials even if Google revocation is unavailable.
  const { data: removed, error } = await supabase
    .from("gmail_connections")
    .delete()
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .eq("connection_id", expected)
    .select("connection_id");
  if (error || !removed?.length)
    return {
      error: "Connection changed or could not be removed. Reload status.",
      disconnected: false,
    };
  try {
    const config = gmailConfig(),
      refresh = unseal(
        row.encrypted_refresh_token,
        context(workspace.id, user.id, row.connection_id, row.email),
        config.key,
      );
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refresh }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error();
    return { error: null, disconnected: true };
  } catch {
    return {
      error:
        "Disconnected from Dopio. Google revocation could not be confirmed; remove Dopio access in your Google Account permissions. Imported emails remain in this workspace.",
      disconnected: true,
    };
  }
}

// Explicit setup selection: read sources without importing or changing the inbox.
export async function readSetupEmails(expected:string,ids:string[]) {
 await requireWorkspace();
 if(!Array.isArray(ids)||ids.length>10||ids.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(id)))return {error:'Choose up to 10 emails.',sources:[]};
 try {
  const c=await currentConnection(expected);
  const token=await tokenRequest({client_id:c.config.clientId,client_secret:c.config.clientSecret,grant_type:'refresh_token',refresh_token:c.refresh});
  const sources=[];
  for(const id of [...new Set(ids)]){
   const raw=await gmailGet(`messages/${encodeURIComponent(id)}?format=full`,token.access_token) as GmailMessage;
   const m=summarizeMessage(raw);
   sources.push({id:`gmail:${id}`,label:`${m.subject} — ${m.sender}`,text:messageText(raw).slice(0,12000)});
  }
  return {sources,error:null};
 }catch{return {sources:[],error:'Could not read the selected emails. Reconnect Gmail and try again.'};}
}

// Explicit assistant retrieval: read-only, bounded, current member's connection.
export async function searchAssistantGmail(question:string){
 await requireWorkspace();
 if(typeof question!=='string'||question.length>6000)return {sources:[],error:'Enter a shorter Gmail search.'};
 try{
  const c=await currentConnection();
  const token=await tokenRequest({client_id:c.config.clientId,client_secret:c.config.clientSecret,grant_type:'refresh_token',refresh_token:c.refresh});
  const words=(question.match(/[\p{L}\p{N}]{3,}/gu)??[]).filter(w=>!['the','and','about','emails','look','through','release','tell','what','outstanding','please','with','from','have','find'].includes(w.toLowerCase())).slice(0,8);
  const q='newer_than:90d'+(words.length?' {'+words.map(w=>'"'+w+'"').join(' ')+'}':'');
  const list=await gmailGet('messages?maxResults=5&q='+encodeURIComponent(q),token.access_token);
  const sources=await Promise.all((list.messages??[]).slice(0,5).map(async({id}:{id:string})=>{
   const raw=await gmailGet(`messages/${encodeURIComponent(id)}?format=full`,token.access_token) as GmailMessage;
   const m=summarizeMessage(raw);
   return {key:`gmail:${id}`,label:m.subject,href:`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}`,record:{id,sender:m.sender,subject:m.subject,received:m.received,body:messageText(raw).slice(0,10000)}};
  }));
  return {sources,error:null};
 }catch(e){return {sources:[],error:safeError(e)};}
}
