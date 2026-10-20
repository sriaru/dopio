"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  gmailStatus,
  startGmailConnection,
  listGmailMessages,
  importGmailMessage,
  disconnectGmail,
} from "@/app/gmail/actions";
import type { GmailSummary } from "@/lib/gmail/api";
import type { WorkspaceData } from "@/lib/workspace/types";
const callbackMessages: Record<string, string> = {
  connected: "Gmail connected. Load recent emails to choose what to import.",
  cancelled: "Google connection was cancelled. Nothing was imported.",
  permission:
    "Google did not grant the required offline read access. Connect again and allow Gmail read access.",
  failed:
    "Gmail connection could not finish. Check setup, then reconnect from this browser.",
};
export default function GmailConnection({
  onData,
  compact=false,
}: {
  compact?: boolean;
  onData: (data: WorkspaceData) => void;
}) {
  const [status, setStatus] = useState<Awaited<
    ReturnType<typeof gmailStatus>
  > | null>(null);
  const [messages, setMessages] = useState<GmailSummary[]>([]),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [imported, setImported] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    gmailStatus()
      .then((s) => {
        if (active) {
          setStatus(s);
          const code = new URLSearchParams(window.location.search).get("gmail");
          if (code && callbackMessages[code]) setNotice(callbackMessages[code]);
        }
      })
      .catch(() => {
        if (active) setError("Could not load Gmail status. Reload the page.");
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch {
      setError(
        "Could not complete the Gmail request. Reload the page and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={compact?"gmail-panel gmail-compact":"panel gmail-panel"} aria-label="Gmail connection">
      <div className="panel-heading">
        <div>
          <h2>Gmail</h2>
          <p>
            {status?.email
              ? `Account saved: ${status.email}. Google access is checked when you load or import email.`
              : "Bring selected real emails into Dopio."}
          </p>
        </div>
        <span className="badge purple">Read only</span>
      </div>
      <details open={compact?undefined:true}><summary>{status?.email?"Manage connection & import":"Connect & import emails"}</summary>
      <p className="gmail-explanation">
        You choose which emails to import. Imported text is saved in this
        workspace with its existing email access permissions. Loading the list does not save
        emails. No messages are sent, no tasks change, and no AI calls run.
      </p>
      {error && (
        <p className="auth-feedback error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="email-notice" role="status">
          {notice}
        </p>
      )}
      {status?.error && (
        <p className="auth-feedback error">
          {status.error} <Link href="/gmail-setup">Open setup guide →</Link>
        </p>
      )}
      {!status ? (
        <p>Checking connection…</p>
      ) : (
        <div className="gmail-controls">
          {!status.email ? (
            <button
              className="button primary"
              disabled={busy || !status.configured || !!status.error}
              onClick={() =>
                void run(async () => {
                  const r = await startGmailConnection();
                  if (r?.error) setError(r.error);
                })
              }
            >
              Connect Gmail
            </button>
          ) : (
            <>
              <button
                className="button primary"
                disabled={busy || !status.configured}
                onClick={() =>
                  void run(async () => {
                    const r = await listGmailMessages(status.connectionId!);
                    setMessages(r.messages);
                    setLoaded(true);
                    if (r.error) setError(r.error);
                  })
                }
              >
                {busy ? "Working…" : "Load recent emails"}
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Disconnect Gmail? Imported emails remain in this workspace.",
                    )
                  )
                    void run(async () => {
                      const r = await disconnectGmail(status.connectionId!);
                      if (r.disconnected) {
                        setMessages([]);
                        setLoaded(false);
                        setImported([]);
                        setStatus({
                          ...status,
                          email: null,
                          connectionId: null,
                        });
                        setNotice(
                          "Gmail disconnected. Previously imported emails remain in your workspace.",
                        );
                      }
                      if (r.error) setError(r.error);
                    });
                }}
              >
                Disconnect
              </button>
            </>
          )}
          <button
            className="text-link"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setStatus(await gmailStatus());
                setMessages([]);
                setLoaded(false);
                setImported([]);
              })
            }
          >
            Reload status
          </button>
        </div>
      )}
      {status?.email && (
        <p className="gmail-explanation">
          Manual import only: up to 10 recent inbox emails from the last 30
          days. Attachments are excluded. Automatic sync and artist-brief
          extraction come later.
        </p>
      )}
      {loaded && !messages.length && !error && (
        <p>No inbox emails were found in the last 30 days.</p>
      )}
      {messages.length > 0 && (
        <ul className="gmail-message-list">
          {messages.map((m) => (
            <li key={m.id}>
              <div>
                <strong>{m.subject}</strong>
                <p>{m.sender}</p>
                <small>
                  {new Date(m.received).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </small>
              </div>
              <button
                className="button secondary"
                disabled={busy || imported.includes(m.id)}
                onClick={() =>
                  void run(async () => {
                    const r = await importGmailMessage(
                      m.id,
                      status!.connectionId!,
                    );
                    if (r.error) setError(r.error);
                    else if (r.data) {
                      onData(r.data);
                      setImported([...imported, m.id]);
                      setNotice(
                        "Email imported below. Duplicate imports are kept once. No AI analysis or task changes were made.",
                      );
                    }
                  })
                }
              >
                {imported.includes(m.id) ? "Imported" : "Import to workspace"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <a
        className="text-link"
        href="https://myaccount.google.com/connections"
        target="_blank"
        rel="noreferrer"
      >
        Manage access in your Google Account ↗
      </a>
      </details>
    </section>
  );
}
