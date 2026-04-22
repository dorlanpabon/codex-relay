import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { TaskCreateSchema } from "@codex-relay/contracts";

import { ConnectorHubService } from "../connectors/connector-hub.service.js";
import { CommandsService } from "../commands/commands.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commandsService: CommandsService,
    private readonly connectorHub: ConnectorHubService
  ) {}

  async createTask(userId: string, body: unknown) {
    const payload = TaskCreateSchema.parse(body);
    const project = await this.prisma.project.findUnique({
      where: { id: payload.projectId },
      include: {
        connector: true
      }
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.connector.ownerId !== userId) {
      throw new ForbiddenException("Project does not belong to the active user");
    }

    if (!project.connector.appServerReady) {
      throw new ConflictException(
        "Connector app-server is not ready. Configure CODEX_COMMAND and restart the connector.",
      );
    }

    const sessionId = randomUUID();
    const session = await this.prisma.session.create({
      data: {
        id: sessionId,
        ownerId: userId,
        connectorId: project.connectorId,
        projectId: payload.projectId,
        threadId: payload.threadId ?? null,
        prompt: payload.prompt,
        status: "queued",
        autoContinueMode: payload.autoContinuePolicy.mode,
        autoContinueMaxTurns: payload.autoContinuePolicy.maxAutoTurns,
        continuePrompt: payload.autoContinuePolicy.continuePrompt
      }
    });

    const command = await this.commandsService.createStartCommand(session.id, payload);
    await this.connectorHub.dispatchQueuedCommand(project.connectorId, command);

    return session;
  }
}
