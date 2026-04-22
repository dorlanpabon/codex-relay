"use client";

import { useState, useTransition } from "react";

import { createTask } from "../lib/api";

type ProjectOption = {
  id: string;
  name: string;
  repoPath: string;
};

export function TaskForm({ projects }: { projects: ProjectOption[] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [prompt, setPrompt] = useState(
    "Continua con el proyecto y solo pide ayuda cuando haya una decision real.",
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedProject = projects.find((project) => project.id === projectId);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!selectedProject) {
          setError("Selecciona un proyecto");
          return;
        }

        startTransition(async () => {
          try {
            setError(null);
            const session = await createTask({
              projectId: selectedProject.id,
              repoPath: selectedProject.repoPath,
              prompt,
            });
            window.location.href = `/sessions/${session.id}`;
          } catch (submitError) {
            setError(
              submitError instanceof Error
                ? submitError.message
                : "No fue posible crear la tarea",
            );
          }
        });
      }}
    >
      <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name} / {project.repoPath}
          </option>
        ))}
      </select>
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="Describe la tarea para Codex"
      />
      {error ? <div className="pill danger">{error}</div> : null}
      <button type="submit" disabled={isPending || !projects.length}>
        {isPending ? "Creando..." : "Lanzar tarea"}
      </button>
    </form>
  );
}
