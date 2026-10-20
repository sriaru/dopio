import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export function encryptionKey(value: string | undefined) {
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value))
    throw new Error("Gmail encryption is not configured.");
  return Buffer.from(value, "hex");
}
export function seal(value: string, context: string, key: Buffer) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function unseal(value: string, context: string, key: Buffer) {
  const [version, iv, tag, data, ...extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data || extra.length)
    throw new Error("Invalid encrypted token");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
export type PendingOAuth = {
  returnTo?: "/get-started";
  state: string;
  verifier: string;
  user: string;
  workspace: string;
  expires: number;
};
export function newPendingOAuth(user: string, workspace: string): PendingOAuth {
  return {
    state: randomBytes(32).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"),
    user,
    workspace,
    expires: Date.now() + 600000,
  };
}
export function validPendingOAuth(
  p: PendingOAuth,
  state: string,
  user: string,
  workspace: string,
) {
  if (
    !p ||
    typeof p.state !== "string" ||
    typeof p.verifier !== "string" ||
    p.verifier.length < 43 ||
    !Number.isFinite(p.expires) ||
    p.expires < Date.now() ||
    p.user !== user ||
    p.workspace !== workspace
  )
    return false;
  const a = Buffer.from(p.state),
    b = Buffer.from(state);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function authorizationURL(
  p: PendingOAuth,
  clientId: string,
  redirectUri: string,
) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent select_account",
    state: p.state,
    code_challenge: createHash("sha256").update(p.verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}
