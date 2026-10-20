import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { requireWorkspace, requireUser } from "@/lib/auth/session";
import { gmailConfig } from "@/lib/gmail/config";
import {
  unseal,
  seal,
  validPendingOAuth,
  GMAIL_SCOPE,
  type PendingOAuth,
} from "@/lib/gmail/security";
import { gmailGet, tokenRequest } from "@/lib/gmail/api";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const { workspace, user } = await requireWorkspace();
  const { supabase } = await requireUser();
  const jar = await cookies(),
    cookie = jar.get("aura-gmail-oauth")?.value;
  jar.set("aura-gmail-oauth", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/gmail",
    maxAge: 0,
  });
  let outcome = "failed";
  let setup = false;
  try {
    const config = gmailConfig();
    if (request.nextUrl.origin !== config.origin) throw new Error();
    const state = request.nextUrl.searchParams.get("state") ?? "";
    const pending = JSON.parse(
      unseal(cookie ?? "", "gmail-oauth", config.key),
    ) as PendingOAuth;
    if (!validPendingOAuth(pending, state, user.id, workspace.id))
      throw new Error();
    setup = pending.returnTo === "/get-started";
    if (request.nextUrl.searchParams.has("error")) outcome = "cancelled";
    else {
      const code = request.nextUrl.searchParams.get("code");
      if (!code) throw new Error();
      const token = await tokenRequest({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
        code,
        code_verifier: pending.verifier,
      });
      if (
        !token.refresh_token ||
        !token.scope?.split(" ").includes(GMAIL_SCOPE)
      ) {
        outcome = "permission";
      } else {
        const profile = await gmailGet("profile", token.access_token);
        if (
          typeof profile.emailAddress !== "string" ||
          profile.emailAddress.length > 254
        )
          throw new Error();
        const id = randomUUID(),
          email = profile.emailAddress.toLowerCase();
        const encrypted = seal(
          token.refresh_token,
          `gmail:${workspace.id}:${user.id}:${id}:${email}`,
          config.key,
        );
        const { data: saved, error } = await supabase
          .from("gmail_connections")
          .upsert(
            {
              workspace_id: workspace.id,
              user_id: user.id,
              connection_id: id,
              email,
              encrypted_refresh_token: encrypted,
              connected_at: new Date().toISOString(),
              can_send: token.scope?.split(" ").includes("https://www.googleapis.com/auth/gmail.send") ?? false,
            },
            { onConflict: "workspace_id,user_id" },
          ).select("connection_id").single();
        if (error || saved?.connection_id!==id) throw new Error();
        outcome = "connected";
      }
    }
  } catch {
    /* Never put Google responses, auth codes, or credentials into a redirect or logs. */
  }
  const response = NextResponse.redirect(
    new URL(setup ? `/get-started?gmail=${outcome}` : `/?view=Inbox&gmail=${outcome}`, request.url),
  );
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
