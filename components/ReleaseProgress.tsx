"use client";
import {isOpenTask,isCompletedTask,isOverdueTask,DEFAULT_TIME_ZONE} from "@/lib/workspace/rules";
import { useState } from "react";
import type { ReleaseRecord, TaskRecord } from "@/lib/workspace/types";

export default function ReleaseProgress({
  release,
  tasks,
  today,
  timeZone=DEFAULT_TIME_ZONE,
  onLink,
}: {
  release: ReleaseRecord;
  tasks: TaskRecord[];
  today: string;
  timeZone?:string;
  onLink: (id: string) => void;
}) {
  const [taskId, setTaskId] = useState("");
  const linked = tasks.filter((t) => t.release_id === release.id&&!t.archived_at);
  const complete = linked.filter(isCompletedTask).length;
  const open = linked.filter(isOpenTask);
  const overdue = open.filter(t=>isOverdueTask(t,today));
  const dueToday = open.filter((t) => t.due_date === today);
  const undated = open.filter((t) => !t.due_date);
  const afterRelease = open.filter(
    (t) =>
      t.due_date && release.release_date && t.due_date > release.release_date,
  );
  const available = tasks.filter(
    (t) => !t.release_id && t.artist_id === release.artist_id,
  );
  const percent = linked.length
    ? Math.round((complete / linked.length) * 100)
    : 0;
  const next = open
    .filter((t) => t.due_date)
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!))[0];
  const label = (value: string) =>
    new Date(value + "T12:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  return (
    <section
      className="panel live-panel-gap release-progress"
      aria-label="Release progress"
    >
      <div className="panel-heading">
        <h2>Release progress</h2>
        <strong>
          {linked.length ? `${percent}% complete` : "No tasks linked"}
        </strong>
      </div>
      <progress max={100} value={percent} aria-label="Linked tasks completed" />
      <p>
        {complete} of {linked.length} tasks complete · {open.length} remaining
      </p>
      <div className="release-progress-counts">
        <div>
          <strong>{overdue.length}</strong>
          <span>Overdue</span>
        </div>
        <div>
          <strong>{dueToday.length}</strong>
          <span>Due today</span>
        </div>
        <div>
          <strong>{undated.length}</strong>
          <span>Need a deadline</span>
        </div>
      </div>
      {overdue.length > 0 && (
        <p className="auth-feedback error" role="status">
          Needs attention: {overdue.length} unfinished{" "}
          {overdue.length === 1 ? "task is" : "tasks are"} past due. Review the
          tasks below.
        </p>
      )}
      {next && (
        <p>
          <strong>
            {next.due_date! < today
              ? "Oldest outstanding deadline"
              : "Next deadline"}
            :
          </strong>{" "}
          {next.title} · {label(next.due_date!)}
        </p>
      )}
      {afterRelease.length > 0 && (
        <p>
          {afterRelease.length} open{" "}
          {afterRelease.length === 1 ? "task falls" : "tasks fall"} after the
          release date. Check whether these are planned follow-up tasks.
        </p>
      )}
      {!release.release_date && (
        <p>Set a release date to compare task deadlines against launch.</p>
      )}
      {linked.length > 0 && open.length === 0 && (
        <p>All linked tasks are complete.</p>
      )}
      <small>
        Progress reflects linked tasks. The release status is managed
        separately. Dates use {timeZone}.
      </small>
      {available.length > 0 && (
        <div className="release-link-task">
          <label htmlFor="release-existing-task">
            Link an existing artist task
          </label>
          <select
            id="release-existing-task"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
          >
            <option value="">Choose a task</option>
            {available.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <button
            className="button secondary"
            disabled={!available.some((t) => t.id === taskId)}
            onClick={() => onLink(taskId)}
          >
            Review and link task
          </button>
          <small>
            Review the selected release in the task form, then save.
          </small>
        </div>
      )}
    </section>
  );
}
