import "server-only";
import { encryptionKey } from "./security";
export function gmailConfig() {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID,
    clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET,
    redirectUri = process.env.GOOGLE_GMAIL_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri)
    throw new Error("Gmail setup is incomplete. Follow docs/GMAIL_SETUP.md.");
  const url = new URL(redirectUri);
  if (
    url.pathname !== "/gmail/callback" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && url.hostname === "localhost"))
  )
    throw new Error(
      "Gmail redirect URI must use HTTPS, or HTTP localhost, with /gmail/callback.",
    );
  return {
    clientId,
    clientSecret,
    redirectUri,
    origin: url.origin,
    key: encryptionKey(process.env.GMAIL_TOKEN_ENCRYPTION_KEY),
  };
}
