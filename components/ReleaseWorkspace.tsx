"use client";

import { useState } from "react";

type ChecklistItem = {
  id: number;
  name: string;
  status: "missing" | "pending";
  completed: boolean;
};

export default function ReleaseWorkspace() {
  const [checklist, setChecklist] = useState<ChecklistItem[]>([
    {
      id: 1,
      name: "Final master",
      status: "missing",
      completed: false,
    },
    {
      id: 2,
      name: "Artwork",
      status: "missing",
      completed: false,
    },
    {
      id: 3,
      name: "Release metadata",
      status: "missing",
      completed: false,
    },
    {
      id: 4,
      name: "ISRC",
      status: "missing",
      completed: false,
    },
    {
      id: 5,
      name: "Songwriting splits",
      status: "missing",
      completed: false,
    },
    {
      id: 6,
      name: "Distribution",
      status: "pending",
      completed: false,
    },
    {
      id: 7,
      name: "Pre-save campaign",
      status: "pending",
      completed: false,
    },
    {
      id: 8,
      name: "Press assets",
      status: "pending",
      completed: false,
    },
    {
      id: 9,
      name: "Social assets",
      status: "pending",
      completed: false,
    },
  ]);

  function toggleItem(id: number) {
    setChecklist(
      checklist.map((item) =>
        item.id === id
          ? { ...item, completed: !item.completed }
          : item
      )
    );
  }

  const completedCount = checklist.filter(
    (item) => item.completed
  ).length;

  const progress = Math.round(
    (completedCount / checklist.length) * 100
  );

  return (
    <>
      {/* Release Readiness */}
      <div className="mt-10 rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-copy">
              RELEASE READINESS
            </p>

            <p className="mt-1 text-2xl font-semibold">
              {progress}%
            </p>
          </div>

          <p className="text-sm text-copy">
            {completedCount} of {checklist.length} complete
          </p>
        </div>

        <div className="mt-4 h-2 rounded-full bg-gray-200">
          <div
            className="h-2 rounded-full bg-black transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="mt-6 grid grid-cols-3 gap-6">

        {/* Checklist */}
        <div className="col-span-2 rounded-xl border border-gray-200 p-6">

          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">
                Release Checklist
              </h2>

              <p className="mt-1 text-sm text-copy">
                Everything needed to get this release out.
              </p>
            </div>

            <button className="text-sm font-medium">
              + Add Task
            </button>
          </div>

          <div className="mt-6">
            {checklist.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between border-b border-gray-100 py-4 last:border-0"
              >
                <div className="flex items-center gap-3">

                  {/* Clickable checkbox */}
                  <button
                    onClick={() => toggleItem(item.id)}
                    className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                      item.completed
                        ? "border-black bg-black text-white"
                        : "border-gray-300"
                    }`}
                  >
                    {item.completed && (
                      <span className="text-xs">✓</span>
                    )}
                  </button>

                  <span
                    className={
                      item.completed
                        ? "text-copy line-through"
                        : "font-medium"
                    }
                  >
                    {item.name}
                  </span>

                </div>

                {item.completed ? (
                  <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                    Complete
                  </span>
                ) : (
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      item.status === "missing"
                        ? "bg-red-50 text-red-700"
                        : "bg-gray-100 text-copy"
                    }`}
                  >
                    {item.status === "missing"
                      ? "Missing"
                      : "Pending"}
                  </span>
                )}

              </div>
            ))}
          </div>
        </div>

        {/* Dopio Agent */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-6">

          <p className="text-xs font-semibold uppercase tracking-wide text-copy">
            ✦ Dopio
          </p>

          <h2 className="mt-3 text-lg font-semibold">
            Release status
          </h2>

          <p className="mt-2 text-sm leading-6 text-copy">
            I&apos;m tracking everything needed for this release.
            You&apos;ve completed {completedCount} of{" "}
            {checklist.length} items.
          </p>

          {/* Missing items */}
          <div className="mt-5 rounded-lg bg-white p-4">
            <p className="text-sm font-medium">
              Still needed:
            </p>

            <ul className="mt-3 space-y-2 text-sm text-copy">
              {checklist
                .filter((item) => !item.completed)
                .slice(0, 4)
                .map((item) => (
                  <li key={item.id}>
                    • {item.name}
                  </li>
                ))}
            </ul>

            {completedCount === checklist.length && (
              <p className="mt-3 text-sm font-medium">
                Everything is ready.
              </p>
            )}
          </div>

          <button className="mt-5 w-full rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white">
            Upload Assets
          </button>

          <button className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium">
            Ask Dopio
          </button>

        </div>
      </div>
    </>
  );
}