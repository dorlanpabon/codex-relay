import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  ConnectorCommandEnvelope,
  ControlCommand,
  SessionResumePayload,
  SessionStatus,
  TaskCreate
} from "@codex-relay/contracts";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service.js";

type CommandWithSession = Prisma.CommandGetPayload<{
  include: {
    session: true;
  };
}>;

@Injectable()
export class CommandsService {
  constructor(private readonly prisma: PrismaService) {}

  private toRecoverableStatus(status: string): SessionStatus {
    return status === "paused" || status === "waiting_for_approval" || status === "running"
      ? status
      : "running";
  }

  async createStartCommand(sessionId: string, payload: TaskCreate): Promise<CommandWithSession> {
    return this.prisma.command.create({
      data: {
        sessionId,
        type: "task.start",
        payload: payload as unknown as Prisma.InputJsonValue
      },
      include: {
        session: true
      }
    });
  }

  async createUserCommand(
    userId: string,
    payload: ControlCommand
  ): Promise<CommandWithSession> {
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sessionId },
      include: {
        project: true,
      },
    });

    if (!session) {
      throw new NotFoundException("Session not found");
    }

    if (session.ownerId !== userId) {
      throw new ForbiddenException("Session does not belong to the active user");
    }

    const storedPayload =
      payload.command === "resume_thread"
        ? (() => {
            const threadId = payload.threadId ?? session.threadId;
            if (!threadId) {
              throw new BadRequestException("Session does not have a thread to resume");
            }

            return {
              threadId,
              projectId: session.projectId,
              repoPath: session.project.repoPath,
              prompt: session.prompt,
              continuePrompt: session.continuePrompt,
              status: this.toRecoverableStatus(session.status),
            } satisfies SessionResumePayload;
          })()
        : payload;

    return this.prisma.command.create({
      data: {
        sessionId: payload.sessionId,
        type: payload.command,
        approvalId: payload.approvalId ?? null,
        decision: payload.decision ?? null,
        payload: storedPayload as unknown as Prisma.InputJsonValue
      },
      include: {
        session: true
      }
    });
  }

  async createSystemContinue(sessionId: string): Promise<CommandWithSession> {
    return this.prisma.command.create({
      data: {
        sessionId,
        type: "continue",
        payload: {
          sessionId,
          command: "continue"
        }
      },
      include: {
        session: true
      }
    });
  }

  async markSent(commandId: string): Promise<void> {
    await this.prisma.command.update({
      where: { id: commandId },
      data: { status: "sent" }
    });
  }

  async markFailed(commandId: string, error: string): Promise<void> {
    await this.prisma.command.update({
      where: { id: commandId },
      data: {
        status: "failed",
        error
      }
    });
  }

  async listQueuedCommands(connectorId: string): Promise<CommandWithSession[]> {
    return this.prisma.command.findMany({
      where: {
        status: "queued",
        session: {
          connectorId
        }
      },
      include: {
        session: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });
  }

  toEnvelope(command: CommandWithSession): ConnectorCommandEnvelope {
    switch (command.type) {
      case "task.start":
        return {
          type: "task.start",
          sessionId: command.sessionId,
          payload: command.payload as TaskCreate
        };
      case "resume_thread":
        return {
          type: "session.resume",
          sessionId: command.sessionId,
          payload: (command.payload ?? {}) as SessionResumePayload
        };
      default:
        return {
          type: "session.command",
          sessionId: command.sessionId,
          payload: command.payload as ControlCommand
        };
    }
  }
}
