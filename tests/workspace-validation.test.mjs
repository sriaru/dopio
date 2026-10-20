import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = ts.transpile(
  readFileSync(
    new URL("../lib/workspace/validation.ts", import.meta.url),
    "utf8",
  ),
  { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
);
const { parseRecord } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
function form(values) {
  const result = new FormData();
  Object.entries(values).forEach(([key, value]) => result.set(key, value));
  return result;
}
test("record validation rejects malformed dates, IDs, names, and statuses", () => {
  const task = {
    title: " Deliver artwork ",
    status: "Pending",
    priority: "High",
    due_date: "2026-09-30",
  };
  assert.equal(parseRecord("task", form(task)).title, "Deliver artwork");
  assert.equal(parseRecord("task", form(task)).artist_id, null);
  for (const due_date of [
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "09/30/2026",
    "1800-01-01",
  ])
    assert.throws(() => parseRecord("task", form({ ...task, due_date })));
  assert.equal(
    parseRecord("task", form({ ...task, due_date: "2028-02-29" })).due_date,
    "2028-02-29",
  );
  for (const patch of [
    { title: "   " },
    { title: "x".repeat(151) },
    { status: "Fake" },
    { priority: "Urgent" },
    { artist_id: "other-user" },
    { notes: "x".repeat(5001) },
  ])
    assert.throws(() => parseRecord("task", form({ ...task, ...patch })));
  assert.throws(() =>
    parseRecord(
      "release",
      form({ title: "First release", status: "Planning", format: "Single" }),
    ),
  );
  const artist = parseRecord(
    "artist",
    form({
      name: "Maya",
      genre: "Pop",
      status: "Active",
      workspace_id: "untrusted",
      record_id: "untrusted",
      created_at: "untrusted",
    }),
  );
  assert.deepEqual(
    artist,
    { name: "Maya", genre: "Pop", status: "Active" },
    "must discard identity and scope fields",
  );
});
