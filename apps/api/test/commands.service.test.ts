import { describe, expect, it, vi } from "vitest";

import { CommandsService } from "../src/modules/commands/commands.service.js";

describe("CommandsService", () => {
  it("builds a full resume payload from the stored session state", async () => {
    const prisma = {
      session: {
        findUnique: vi.fn().mockResolvedValue({
          id: "session-1",
          ownerId: "local-dev-user",
          threadId: "thread-1",
          projectId: "project-1",
          prompt: "Implementa la tarea",
          continuePrompt: "Continua hasta terminar.",
          status: "paused",
          project: {
            repoPath: "D:\\xampp\\htdocs\\open_source",
          },
        }),
      },
      command: {
        create: vi.fn().mockResolvedValue({
          id: "command-1",
          session: {
            connectorId: "connector-1",
          },
        }),
      },
    };
    const service = new CommandsService(prisma as never);

    await service.createUserCommand("local-dev-user", {
      sessionId: "session-1",
      command: "resume_thread",
    });

    expect(prisma.command.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "resume_thread",
          payload: {
            threadId: "thread-1",
            projectId: "project-1",
            repoPath: "D:\\xampp\\htdocs\\open_source",
            prompt: "Implementa la tarea",
            continuePrompt: "Continua hasta terminar.",
            status: "paused",
          },
        }),
      }),
    );
  });
});
