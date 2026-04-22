import { describe, expect, it } from "vitest";

import { AppServerClient } from "../src/codex/app-server-client.js";

describe("AppServerClient", () => {
  it("rehydrates a session without touching the app-server process", () => {
    const client = new AppServerClient({
      commandLine: "codex",
    });
    const snapshots: Array<{ status: string; threadId?: string }> = [];

    client.on("session.snapshot", (snapshot) => {
      snapshots.push({
        status: snapshot.status,
        threadId: snapshot.threadId,
      });
    });

    client.restoreSession("session-1", {
      threadId: "thread-1",
      projectId: "project-1",
      repoPath: "D:\\xampp\\htdocs\\open_source",
      prompt: "Implementa la tarea",
      continuePrompt: "Continua hasta terminar.",
      status: "waiting_for_approval",
    });

    client.pauseSession("session-1");

    expect(snapshots).toEqual([
      {
        status: "waiting_for_approval",
        threadId: "thread-1",
      },
      {
        status: "paused",
        threadId: "thread-1",
      },
    ]);
  });
});
