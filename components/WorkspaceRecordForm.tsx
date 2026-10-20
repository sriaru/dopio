"use client";
import {taskStatusLabel} from '@/lib/workspace/task-status';
import { useState, type FormEvent } from "react";
import type { Entity, WorkspaceData } from "@/lib/workspace/types";
import Icon from "./DopioIcon";
export default function WorkspaceRecordForm({
  entity,
  id,
  data,
  busy,
  onSave,
  onCancel,
  defaultArtist,
  defaultRelease,
}: {
  entity: Entity;
  id?: string;
  data: WorkspaceData;
  busy: boolean;
  onSave: (form: FormData) => void;
  onCancel: () => void;
  defaultArtist?: string;
  defaultRelease?: string;
}) {
  const artist = data.artists.find((a) => a.record_id === id);
  const release = data.releases.find((r) => r.id === id);
  const task = data.tasks.find((t) => t.id === id);
  const [editVersion]=useState((entity==="artist"?artist:entity==="release"?release:task)?.version??0);
  const [artistId, setArtistId] = useState(
    (entity === "release" ? release?.artist_id : task?.artist_id) ||
      defaultArtist ||
      "",
  );
  const [releaseId, setReleaseId] = useState(
    task?.release_id || defaultRelease || "",
  );
  const linkedRelease = data.releases.find((r) => r.id === releaseId);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSave(new FormData(e.currentTarget));
  }
  return (
    <form onSubmit={submit} className="record-form">
      <fieldset disabled={busy}>
        {id&&<input type="hidden" name="version" value={editVersion}/>}
        {entity === "artist" ? (
          <>
            <label>
              Artist name
              <input
                name="name"
                defaultValue={artist?.name}
                required
                maxLength={100}
                autoFocus
                placeholder="Artist name"
              />
            </label>
            <label>
              Genre
              <input
                name="genre"
                defaultValue={artist?.genre ?? ""}
                maxLength={100}
                placeholder="e.g. Pop / Alternative"
              />
            </label>
            <label>
              Status
              <select name="status" defaultValue={artist?.status ?? "Active"}>
                <option>Active</option>
                <option>On Hold</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              {entity === "release" ? "Project title" : "Task title"}
              <input
                name="title"
                required
                maxLength={150}
                autoFocus
                defaultValue={
                  entity === "release" ? release?.title : task?.title
                }
                placeholder={
                  entity === "release"
                    ? "Give this release a name"
                    : "What needs to happen?"
                }
              />
            </label>
            <label>
              Artist{entity === "task" ? " (optional)" : ""}
              <select
                name="artist_id"
                value={linkedRelease?.artist_id ?? artistId}
                required={entity === "release"}
                onChange={(e) => {
                  setArtistId(e.target.value);
                  setReleaseId("");
                }}
              >
                <option value="">
                  {entity === "release"
                    ? "Choose an artist"
                    : "No artist — general task"}
                </option>
                {data.artists.map((a) => (
                  <option key={a.record_id} value={a.record_id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            {entity === "release" ? (
              <>
                <div className="record-form-columns">
                  <label>
                    Format
                    <select
                      name="format"
                      defaultValue={release?.format ?? "Single"}
                    >
                      <option>Single</option>
                      <option>EP</option>
                      <option>Album</option>{["Tour","Campaign","Video","Partnership","Other"].map(f=><option key={f}>{f}</option>)}
                    </select>
                  </label>
                  <label>
                    Confirmed project date
                    <input
                      type="date"
                      name="release_date"
                      min="1900-01-01"
                      max="2199-12-31"
                      defaultValue={release?.release_date ?? ""}
                    />
                  </label>
                </div>
                <label>
                  Status
                  <select
                    name="status"
                    defaultValue={release?.status ?? "Planning"}
                  >
                    {["Planning", "On track", "At risk", "Released"].map(
                      (s) => (
                        <option key={s} value={s}>{taskStatusLabel(s)}</option>
                      ),
                    )}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  Project (optional)
                  <select
                    name="release_id"
                    value={releaseId}
                    onChange={(e) => {
                      setReleaseId(e.target.value);
                      const match = data.releases.find(
                        (r) => r.id === e.target.value,
                      );
                      if (match) setArtistId(match.artist_id);
                    }}
                  >
                    <option value="">No release</option>
                    {data.releases
                      .filter((r) => !artistId || r.artist_id === artistId)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Due date
                  <input
                    name="due_date"
                    type="date"
                    min="1900-01-01"
                    max="2199-12-31"
                    defaultValue={task?.due_date ?? ""}
                  />
                </label>
                <div className="record-form-columns">
                  <label>
                    Status
                    <select
                      name="status"
                      defaultValue={task?.status ?? "Pending"}
                    >
                      {["Pending", "In progress", "Complete"].map((s) => (
                        <option key={s} value={s}>{taskStatusLabel(s)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Priority
                    <select
                      name="priority"
                      defaultValue={task?.priority ?? "Normal"}
                    >
                      <option>Normal</option>
                      <option>High</option>
                    </select>
                  </label>
                </div>
              </>
            )}
            <label>Unconfirmed timing (not synced to Calendar)<textarea name="timing_notes" maxLength={1000} rows={2} defaultValue={(entity==='release'?release:task)?.timing_notes||''}/></label>
            <label>
              Notes (optional)
              <textarea
                name="notes"
                maxLength={5000}
                rows={3}
                defaultValue={
                  entity === "release" ? release?.notes : task?.notes
                }
                placeholder="Details for your team"
              />
            </label>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="button primary" type="submit">
            {busy ? "Saving…" : id ? "Save changes" : `Create ${entity}`}
            <Icon name="arrow" size={15} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}
