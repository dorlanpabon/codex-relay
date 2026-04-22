import { describe, expect, it, vi } from "vitest";

import { defaultAutoContinuePolicy } from "@codex-relay/contracts";

import { SessionsService } from "../src/modules/sessions/sessions.service.js";

describe("SessionsService", () => {
  it("does not overwrite autoContinueTurns when a snapshot arrives", async () => {
    const prisma = {
      session: {
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    const service = new SessionsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.upsertSessionSnapshot({
      id: "session-1",
      connectorId: "connector-1",
      projectId: "project-1",
      threadId: "thread-1",
      prompt: "Implementa la tarea",
      status: "paused",
      autoContinueTurns: 99,
      autoContinuePolicy: defaultAutoContinuePolicy(),
      latestSummary: "Session restored",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const call = prisma.session.update.mock.calls[0]?.[0];
    expect(call?.data).toEqual({
      threadId: "thread-1",
      status: "paused",
      latestSummary: "Session restored",
    });
  });

  it("lists recoverable sessions with enough context for the connector", async () => {
    const prisma = {
      session: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "session-1",
            threadId: "thread-1",
            projectId: "project-1",
            prompt: "Implementa la tarea",
            continuePrompt: "Continua hasta terminar.",
            status: "waiting_for_approval",
            project: {
              repoPath: "D:\\xampp\\htdocs\\open_source",
            },
          },
        ]),
      },
    };
    const service = new SessionsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.listRecoverableSessions("local-dev-user", "connector-1"),
    ).resolves.toEqual([
      {
        sessionId: "session-1",
        payload: {
          threadId: "thread-1",
          projectId: "project-1",
          repoPath: "D:\\xampp\\htdocs\\open_source",
          prompt: "Implementa la tarea",
          continuePrompt: "Continua hasta terminar.",
          status: "waiting_for_approval",
        },
      },
    ]);
  });
});
