"use client";
import Link from "next/link";

import { useState } from "react";

type Project = {
  id: number;
  name: string;
  type: string;
  date: string;
  progress: number;
};

export default function ProjectSection() {
  const [projects, setProjects] = useState<Project[]>([
    {
      id: 1,
      name: "Midnight",
      type: "Single Release",
      date: "2026-10-18",
      progress: 73,
    },
  ]);

  const [showModal, setShowModal] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [projectType, setProjectType] = useState("Single Release");
  const [projectDate, setProjectDate] = useState("");

  function createProject() {
    if (!projectName.trim() || !projectDate) return;

    const newProject: Project = {
      id: Date.now(),
      name: projectName,
      type: projectType,
      date: projectDate,
      progress: 0,
    };

    setProjects([...projects, newProject]);

    setProjectName("");
    setProjectType("Single Release");
    setProjectDate("");
    setShowModal(false);
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">
          Current Projects
        </h2>

        <button
          onClick={() => setShowModal(true)}
          className="text-sm font-medium hover:underline"
        >
          + New Project
        </button>
      </div>

      {/* Projects */}
      <div className="mt-4 space-y-4">
        {projects.map((project) => (
        <Link
            key={project.id}
            href={`/projects/${project.id}`}
            className="block rounded-xl border border-gray-200 p-5 transition hover:border-gray-400 hover:shadow-sm"
        >
            <div className="flex justify-between">
              <div>
                <h3 className="font-semibold">
                  {project.name}
                </h3>

                <p className="mt-1 text-sm text-copy">
                  {project.type}
                </p>
              </div>

              <p className="text-sm text-copy">
                {new Date(
                  project.date + "T00:00:00"
                ).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>

            <div className="mt-5">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>{project.progress}%</span>
              </div>

              <div className="mt-2 h-2 rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-black"
                  style={{
                    width: `${project.progress}%`,
                  }}
                />
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* New Project Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">

          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">

            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">
                  Create Project
                </h2>

                <p className="mt-1 text-sm text-copy">
                  What are you working on?
                </p>
              </div>

              <button
                onClick={() => setShowModal(false)}
                className="text-xl text-copy hover:text-black"
              >
                ×
              </button>
            </div>

            {/* Project Type */}
            <div className="mt-6">
              <label className="text-sm font-medium">
                Project type
              </label>

              <select
                value={projectType}
                onChange={(e) => setProjectType(e.target.value)}
                className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-4 py-3"
              >
                <option>Single Release</option>
                <option>EP Release</option>
                <option>Album Release</option>
                <option>Show</option>
                <option>Tour</option>
                <option>Brand Deal</option>
              </select>
            </div>

            {/* Name */}
            <div className="mt-4">
              <label className="text-sm font-medium">
                Project name
              </label>

              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="After Hours"
                className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none"
              />
            </div>

            {/* Date */}
            <div className="mt-4">
              <label className="text-sm font-medium">
                Release / target date
              </label>

              <input
                type="date"
                value={projectDate}
                onChange={(e) => setProjectDate(e.target.value)}
                className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3"
              />
            </div>

            {/* Buttons */}
            <div className="mt-6 flex justify-end gap-3">

              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-gray-300 px-4 py-2"
              >
                Cancel
              </button>

              <button
                onClick={createProject}
                className="rounded-lg bg-black px-4 py-2 text-white"
              >
                Create Project
              </button>

            </div>
          </div>
        </div>
      )}
    </>
  );
}