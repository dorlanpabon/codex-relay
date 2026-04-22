import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { TasksService } from "../src/modules/tasks/tasks.service.js";

describe("TasksService", () => {
  it("rejects task creation when the connector app-server is not ready", async () => {
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: "project-1",
          connectorId: "connector-1",
          connector: {
            ownerId: "local-dev-user",
            appServerReady: false,
          },
        }),
      },
      session: {
        create: vi.fn(),
      },
    };
    const commandsService = {
      createStartCommand: vi.fn(),
    };
    const connectorHub = {
      dispatchQueuedCommand: vi.fn(),
    };
    const service = new TasksService(
      prisma as never,
      commandsService as never,
      connectorHub as never,
    );

    await expect(
      service.createTask("local-dev-user", {
        projectId: "project-1",
        repoPath: "D:\\xampp\\htdocs\\open_source",
        prompt: "Continua",
        threadMode: "new",
        autoContinuePolicy: {
          mode: "safe",
          maxAutoTurns: 5,
          continuePrompt: "Continua hasta terminar.",
        },
      }),
    ).rejects.toThrow(ConflictException);

    expect(prisma.session.create).not.toHaveBeenCalled();
    expect(commandsService.createStartCommand).not.toHaveBeenCalled();
    expect(connectorHub.dispatchQueuedCommand).not.toHaveBeenCalled();
  });
});
