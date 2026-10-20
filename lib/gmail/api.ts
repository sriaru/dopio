export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string };
  parts?: GmailPart[];
};
export type GmailMessage = {
  id: string;
  internalDate?: string;
  payload?: GmailPart;
};
export type GmailSummary = {
  id: string;
  sender: string;
  subject: string;
  received: string;
};
export async function googleJSON(
  url: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
) {
  const res = await fetcher(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    if (res.status === 401)
      throw new Error(
        "Gmail access expired or was revoked. Disconnect and reconnect Gmail.",
      );
    if (res.status === 403)
      throw new Error(
        "Gmail access was denied. Check that the Gmail API is enabled and read access was granted.",
      );
    if (res.status === 429)
      throw new Error(
        "Gmail is rate limiting requests. Wait a minute before retrying.",
      );
    throw new Error(
      "Google could not complete this request. Try again, or reconnect Gmail.",
    );
  }
  return res.json();
}
export async function tokenRequest(
  params: Record<string, string>,
  fetcher: typeof fetch = fetch,
) {
  const res = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok)
    throw new Error(
      res.status===429?"Google is limiting authorization requests. Wait before retrying.":res.status>=500?"Google authorization is temporarily unavailable. Retry later.":"Google authorization failed or expired. Reconnect the Google account and grant the requested access.",
    );
  const data = await res.json();
  if (typeof data.access_token !== "string")
    throw new Error("Google did not return an access token. Reconnect Gmail.");
  return data as {
    access_token: string;
    refresh_token?: string;
    scope?: string;
  };
}
export async function gmailGet(
  path: string,
  token: string,
  fetcher: typeof fetch = fetch,
) {
  return googleJSON(
    "https://gmail.googleapis.com/gmail/v1/users/me/" + path,
    { headers: { Authorization: `Bearer ${token}` } },
    fetcher,
  );
}
export function summarizeMessage(message: GmailMessage): GmailSummary {
  const headers = message.payload?.headers ?? [];
  const header = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name)?.value.trim();
  const ms = Number(message.internalDate);
  if (!Number.isFinite(ms) || ms < 0 || ms > 8640000000000000)
    throw new Error("This message has an unsupported received date.");
  return {
    id: message.id,
    sender: (header("from") || "Unknown sender").slice(0, 254),
    subject: (header("subject") || "(No subject)").slice(0, 200),
    received: new Date(ms).toISOString(),
  };
}
function htmlText(html: string) {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\s*(br|\/p|\/div|\/tr|\/li)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
      (_, entity: string) => {
        const named: Record<string, string> = {
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
          nbsp: " ",
        };
        if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? "";
        const n = entity.toLowerCase().startsWith("#x")
          ? parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
      },
    )
    .trim();
}
export function messageText(message: GmailMessage) {
  const plain: string[] = [],
    html: string[] = [];
  function visit(part: GmailPart, depth = 0) {
    if (depth > 20 || part.filename) return;
    const encoded = part.body?.data;
    if (
      encoded &&
      (part.mimeType === "text/plain" || part.mimeType === "text/html")
    ) {
      if (encoded.length > 200000)
        throw new Error(
          "This email is too large to import. Choose a shorter message.",
        );
      const raw = Buffer.from(encoded, "base64url");
      const contentType =
        part.headers?.find((h) => h.name.toLowerCase() === "content-type")
          ?.value ?? "";
      const charset =
        contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] ?? "utf-8";
      let text: string;
      try {
        text = new TextDecoder(charset).decode(raw);
      } catch {
        throw new Error("This email uses an unsupported text encoding.");
      }
      (part.mimeType === "text/plain" ? plain : html).push(text);
    }
    for (const child of part.parts ?? []) visit(child, depth + 1);
  }
  if (message.payload) visit(message.payload);
  const text = (
    plain.length ? plain.join("\n\n") : html.map(htmlText).join("\n\n")
  )
    .replace(/\u0000/g, "")
    .trim();
  if (!text)
    throw new Error(
      "No inline email text was found. Attachments are not imported.",
    );
  if (text.length > 20000)
    throw new Error(
      "This email exceeds the 20,000-character import limit. No partial email was saved.",
    );
  return text;
}
