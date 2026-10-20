"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { approveReleasePlan } from "@/app/workspace/plan-actions";
import type { WorkspaceData } from "@/lib/workspace/types";
export default function ReleasePlanChat({
  data,
  today,
  draftKey,
}: {
  data: WorkspaceData;
  today: string;
  draftKey: string;
}) {
  const [artist, setArtist] = useState(data.artists[0]?.record_id ?? "");
  const [title, setTitle] = useState("Midnight");
  const [date, setDate] = useState("");
  const [request, setRequest] = useState("");
  const [tasks, setTasks] = useState<{ title: string; due_date: string }[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [format, setFormat] = useState("Single");
  const [notice, setNotice] = useState("");
  const storageKey = `aura:release-draft:${draftKey}`;
  const prompt = request
    ? `Create ${title || "an untitled release"} (${format}) for ${data.artists.find((a) => a.record_id === artist)?.name ?? "the selected artist"}, releasing ${date || "on a date to be set"}, with ${tasks.length} tasks: ${tasks.map((t) => `${t.title || "Untitled task"} (${t.due_date || "no date"})`).join(", ")}.`
    : "";
  function saveDraft() {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ artist, title, date, format, request, tasks }),
      );
      setNotice(
        "Draft saved in this browser. Use Load saved draft when you return. Later edits need to be saved again.",
      );
    } catch {
      setError(
        "Your browser could not save this draft. Keep this page open or enable browser storage.",
      );
    }
  }
  function loadDraft() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setNotice("No saved draft in this browser for this account.");
        return;
      }
      const d = JSON.parse(raw);
      if (
        typeof d.artist !== "string" ||
        typeof d.title !== "string" ||
        typeof d.date !== "string" ||
        typeof d.request !== "string" ||
        !["Single", "EP", "Album"].includes(d.format) ||
        !Array.isArray(d.tasks) ||
        d.tasks.length > 20 ||
        !d.tasks.every(
          (t: { title: unknown; due_date: unknown }) =>
            t && typeof t.title === "string" && typeof t.due_date === "string",
        )
      )
        throw new Error();
      if (!data.artists.some((a) => a.record_id === d.artist)) {
        setError(
          "This draft’s artist is no longer available. Choose an existing artist and start a new plan.",
        );
        return;
      }
      setArtist(d.artist);
      setTitle(d.title);
      setDate(d.date);
      setFormat(d.format);
      setRequest(d.request);
      setTasks(d.tasks);
      setError("");
      setNotice("Saved draft loaded. Review the dates before approving.");
    } catch {
      setError("This saved draft could not be loaded.");
    }
  }
  function preview(e: FormEvent) {
    e.preventDefault();
    setError("");
    setRequest(crypto.randomUUID());
    setTasks(
      [
        ["Final artwork", 21],
        ["Master delivery", 14],
        ["Distributor upload", 7],
      ].map(([name, days]) => {
        const d = new Date(date + "T12:00:00Z");
        d.setUTCDate(d.getUTCDate() - Number(days));
        return { title: String(name), due_date: d.toISOString().slice(0, 10) };
      }),
    );
  }
  async function approve(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    Object.entries({
      request,
      format,
      artist,
      title,
      date,
      tasks: JSON.stringify(tasks),
    }).forEach(([k, v]) => form.set(k, v));
    try {
      const result = await approveReleasePlan(form);
      if (result.error) setError(result.error);
      else if (result.releaseId) {
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* Saving succeeded even if local storage is unavailable. */
        }
        // Fetch a fresh workspace snapshot; LiveWorkspace holds its initial data in local state.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(
          `/?view=Releases&release=${encodeURIComponent(result.releaseId)}`,
        );
      } else
        setError(
          "The save could not be confirmed. Check Releases before retrying.",
        );
    } catch {
      setError(
        "Could not confirm the save. Retry this same plan safely; repeated approval will not create duplicates.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel release-plan">
      <div className="plan-heading">
        <div>
          <p className="eyebrow">Dopio · RELEASE PLANNER</p>
          <h1>Turn your next release into a plan.</h1>
          <p>
            Set the details, review the deadlines, and create everything
            together.
          </p>
        </div>
        <span className="badge purple">
          {request ? "Step 2 of 2 · Review" : "Step 1 of 2 · Plan"}
        </span>
      </div>
      <p className="email-mode-note">
        Sample request builder · No AI calls. This uses a fixed release-planning
        template, not free-form chat.
      </p>
      <div className="plan-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={loadDraft}
        >
          Load saved draft
        </button>
        <span>Drafts are saved only in this browser and account.</span>
      </div>
      {notice && (
        <p role="status" className="email-notice">
          {notice}
        </p>
      )}
      {error && (
        <p className="auth-feedback error" role="alert">
          {error}
        </p>
      )}
      {!data.artists.length ? (
        <>
          <p>Add an artist before planning a release.</p>
          <Link href="/?view=Artists">Open Artists →</Link>
        </>
      ) : (
        <form className="record-form" onSubmit={request ? approve : preview}>
          <fieldset disabled={busy}>
            {prompt && (
              <div className="info-box">
                <strong>Your sample request</strong>
                <p>{prompt}</p>
                <p>
                  Here’s a draft. The dates below use suggested offsets of 21,
                  14, and 7 days before release. Edit them before approving.
                </p>
              </div>
            )}
            <div className="plan-details">
              <label>
                Format
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  {["Single", "EP", "Album"].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label>
                Artist
                <select
                  required
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                >
                  {data.artists.map((a) => (
                    <option key={a.record_id} value={a.record_id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Release title
                <input
                  required
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Release date
                <input
                  required
                  type="date"
                  min="1900-01-22"
                  max="2199-12-31"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            </div>
            {request && (
              <div className="plan-review">
                <h2>Review proposed tasks</h2>
                <p>
                  Creates one {format} in Planning status. Task dates must be on
                  or before release.
                </p>
                {tasks.map((t, i) => (
                  <div key={i} className="plan-task">
                    <label>
                      Task {i + 1}
                      <input
                        required
                        maxLength={200}
                        value={t.title}
                        onChange={(e) =>
                          setTasks(
                            tasks.map((x, j) =>
                              j === i ? { ...x, title: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      Deadline
                      <input
                        required
                        type="date"
                        min="1900-01-01"
                        max={date}
                        value={t.due_date}
                        onChange={(e) =>
                          setTasks(
                            tasks.map((x, j) =>
                              j === i ? { ...x, due_date: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={tasks.length <= 1}
                      onClick={() => setTasks(tasks.filter((_, j) => j !== i))}
                      aria-label={`Remove task ${i + 1}`}
                    >
                      Remove task
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="button secondary"
                  disabled={tasks.length >= 20}
                  onClick={() =>
                    setTasks([...tasks, { title: "", due_date: date }])
                  }
                >
                  Add task ({tasks.length}/20)
                </button>
                {tasks.some((t) => t.due_date < today) && (
                  <p className="auth-feedback">
                    Some proposed deadlines are in the past. Review them before
                    saving.
                  </p>
                )}
                <p>
                  Nothing is saved until you approve. No emails will be sent.
                </p>
              </div>
            )}
            <div className="plan-actions">
              <button
                type="button"
                className="button secondary"
                onClick={saveDraft}
              >
                Save draft
              </button>
              <button className="button primary">
                {busy
                  ? "Saving…"
                  : request
                    ? "Approve and create release + tasks"
                    : "Preview sample request"}
              </button>
              {request && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setRequest("");
                    setTasks([]);
                    try {
                      localStorage.removeItem(storageKey);
                    } catch {
                      setError(
                        "Could not remove the saved draft from browser storage.",
                      );
                    }
                    setNotice("");
                    setError("");
                  }}
                >
                  Discard draft
                </button>
              )}
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
