"use client";
import { useEffect, useState, type FormEvent } from "react";
import { getArtistBrief, saveArtistBrief } from "@/app/workspace/brief-actions";
export default function ArtistBrief({ artist }: { artist: string }) {
  const [fields, setFields] = useState({
    contacts: "",
    release_context: "",
    preferences: "",
  });
  const [version, setVersion] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    getArtistBrief(artist)
      .then((r) => {
        if (!active) return;
        setError(r.error ?? "");
        if (r.brief) {
          setFields({
            contacts: r.brief.contacts,
            release_context: r.brief.release_context,
            preferences: r.brief.preferences,
          });
          setVersion(r.brief.version);
        }
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError("Could not load the brief. Retry to continue.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [artist, retry]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const r = await saveArtistBrief(
        artist,
        version,
        new FormData(e.currentTarget),
      );
      setError(r.error ?? "");
      if (!r.error) {
        setVersion(r.version);
        setNotice(
          "Brief saved. Your team can return to this information here.",
        );
      }
    } catch {
      setError("Could not confirm the save. Reload the brief before retrying.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="release-plan artist-brief">
      <h2>Artist brief</h2>
      <p>
        Keep the context your team needs in one place. Dopio can use release context
        and working preferences when drafting a plan or revising this artist’s
        releases. These notes are entered by your team; emails and calendars do
        not automatically fill them in.
      </p>
      {notice && (
        <p role="status" className="email-notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="auth-feedback error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="text-link"
        disabled={busy || loading}
        onClick={() => {
          if (
            window.confirm(
              "Reload the saved brief? Unsaved edits will be replaced.",
            )
          ) {
            setLoading(true);
            setNotice("");
            setRetry(retry + 1);
          }
        }}
      >
        Reload saved brief
      </button>
      {loading ? (
        <p>Loading brief…</p>
      ) : (
        <form className="record-form" onSubmit={save}>
          <fieldset disabled={busy || !!error}>
            {(
              [
                [
                  "contacts",
                  "Team and contacts",
                  "Names, roles, email addresses, and who owns each deliverable.",
                ],
                [
                  "release_context",
                  "Release context",
                  "Album plans, confirmed dates (include the year), distributor, deliverables, and links to files.",
                ],
                [
                  "preferences",
                  "Working preferences",
                  "Who reviews updates, preferred communication, and any constraints. These notes do not grant permission to send messages.",
                ],
              ] as const
            ).map(([key, label, hint]) => (
              <label key={key}>
                {label}
                <textarea
                  name={key}
                  maxLength={5000}
                  rows={4}
                  value={fields[key]}
                  placeholder={hint}
                  onChange={(e) => {
                    setFields({ ...fields, [key]: e.target.value });
                    setNotice("");
                  }}
                />
              </label>
            ))}
            <div className="plan-actions">
              <button className="button primary">
                {busy ? "Saving…" : "Save artist brief"}
              </button>
              <small>Source: entered by your workspace team</small>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
