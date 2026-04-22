import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ApprovalRequest,
  AutoContinuePolicy,
  ConnectorEventEnvelope,
  SessionEvent,
  SessionResumePayload,
  SessionSnapshot
} from "@codex-relay/contracts";
import { ApprovalRequestSchema, SessionSnapshotSchema } from "@codex-relay/contracts";

import { PrismaService } from "../prisma/prisma.service.js";
import { QueueService } from "../queue/queue.service.js";
import { TelemetryService } from "../telemetry/telemetry.service.js";
import { AutoContinuePolicyService } from "./auto-continue.policy.js";

type RecordedEventOutcome = {
  shouldAutoContinue: boolean;
  sessionId: string;
  reason: string;
};

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly telemetry: TelemetryService,
    private readonly autoContinuePolicy: AutoContinuePolicyService
  ) {}

  async getSession(userId: string, sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        approvals: true,
        commands: {
          orderBy: { createdAt: "desc" },
          take: 10
        },
        connector: true,
        events: {
          orderBy: { createdAt: "desc" },
          take: 50
        },
        project: true
      }
    });

    if (!session) {
      throw new NotFoundException("Session not found");
    }

    if (session.ownerId !== userId) {
      throw new ForbiddenException("Session does not belong to the active user");
    }

    return session;
  }

  async recordSessionEvent(payload: SessionEvent): Promise<RecordedEventOutcome> {
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sessionId },
      include: {
        approvals: {
          where: { status: "pending" }
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 3
        }
      }
    });

    if (!session) {
      throw new NotFoundException("Session not found for incoming event");
    }

    await this.prisma.sessionEvent.create({
      data: {
        sessionId: payload.sessionId,
        type: payload.type,
        severity: payload.severity,
        summary: payload.summary,
        rawRef: payload.rawRef ?? null,
        rawPayload: payload as unknown as object
      }
    });

    const nextStatus =
      payload.type === "turn.completed"
        ? "running"
        : payload.severity === "critical"
          ? "failed"
          : session.status;

    await this.prisma.session.update({
      where: { id: payload.sessionId },
      data: {
        latestSummary: payload.summary,
        status: nextStatus
      }
    });

    const policy: AutoContinuePolicy = {
      mode: session.autoContinueMode as AutoContinuePolicy["mode"],
      maxAutoTurns: session.autoContinueMaxTurns,
      continuePrompt: session.continuePrompt
    };

    const decision = this.autoContinuePolicy.evaluate({
      policy,
      autoContinueTurns: session.autoContinueTurns,
      pendingApprovals: session.approvals.length,
      latestEvent: payload,
      recentEvents: session.events.map((event) => ({
        severity: event.severity as SessionEvent["severity"],
        summary: event.summary,
        type: event.type
      }))
    });

    if (!decision.shouldContinue) {
      if (
        payload.type === "turn.completed" &&
        decision.reason !== "manual_mode" &&
        decision.reason !== "pending_approval"
      ) {
        await this.queue.enqueueTelegramNotification("session-needs-attention", {
          sessionId: payload.sessionId,
          reason: decision.reason,
          summary: payload.summary,
        });
      }

      return {
        shouldAutoContinue: false,
        sessionId: payload.sessionId,
        reason: decision.reason
      };
    }

    await this.prisma.session.update({
      where: { id: payload.sessionId },
      data: {
        autoContinueTurns: {
          increment: 1
        }
      }
    });

    return {
      shouldAutoContinue: true,
      sessionId: payload.sessionId,
      reason: decision.reason
    };
  }

  async recordApprovalRequest(payload: ApprovalRequest): Promise<void> {
    ApprovalRequestSchema.parse(payload);

    await this.prisma.approvalRequest.upsert({
      where: { id: payload.approvalId },
      update: {
        kind: payload.kind,
        message: payload.message,
        options: payload.options,
        expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
        status: "pending"
      },
      create: {
        id: payload.approvalId,
        sessionId: payload.sessionId,
        kind: payload.kind,
        message: payload.message,
        options: payload.options,
        expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
        status: "pending"
      }
    });

    await this.prisma.session.update({
      where: { id: payload.sessionId },
      data: {
        status: "waiting_for_approval",
        latestSummary: payload.message
      }
    });

    await this.queue.enqueueTelegramNotification("approval-requested", {
      approvalId: payload.approvalId,
      sessionId: payload.sessionId,
      kind: payload.kind,
      message: payload.message
    });
  }

  async resolveApprovalRequest(params: {
    approvalId: string;
    sessionId: string;
    decision: string;
  }): Promise<void> {
    await this.prisma.approvalRequest.update({
      where: { id: params.approvalId },
      data: {
        status: "resolved",
        decision: params.decision,
        resolvedAt: new Date()
      }
    });

    await this.prisma.session.update({
      where: { id: params.sessionId },
      data: {
        status: "running"
      }
    });
  }

  async upsertSessionSnapshot(snapshot: SessionSnapshot): Promise<void> {
    const parsed = SessionSnapshotSchema.parse(snapshot);

    await this.prisma.session.update({
      where: { id: parsed.id },
      data: {
        threadId: parsed.threadId ?? null,
        status: parsed.status,
        latestSummary: parsed.latestSummary ?? null
      }
    });
  }

  async listRecoverableSessions(
    ownerId: string,
    connectorId: string,
  ): Promise<Array<{ sessionId: string; payload: SessionResumePayload }>> {
    const sessions = await this.prisma.session.findMany({
      where: {
        ownerId,
        connectorId,
        threadId: {
          not: null,
        },
        status: {
          in: ["running", "waiting_for_approval", "paused"],
        },
      },
      include: {
        project: true,
      },
      orderBy: {
        updatedAt: "asc",
      },
    });

    return sessions
      .filter((session): session is typeof session & { threadId: string } => Boolean(session.threadId))
      .map((session) => ({
        sessionId: session.id,
        payload: {
          threadId: session.threadId,
          projectId: session.projectId,
          repoPath: session.project.repoPath,
          prompt: session.prompt,
          continuePrompt: session.continuePrompt,
          status: session.status as SessionResumePayload["status"],
        },
      }));
  }

  async handleConnectorEnvelope(
    envelope: ConnectorEventEnvelope
  ): Promise<RecordedEventOutcome | null> {
    switch (envelope.type) {
      case "session.event":
        return this.recordSessionEvent(envelope.payload);
      case "approval.requested":
        await this.recordApprovalRequest(envelope.payload);
        return null;
      case "approval.resolved":
        await this.resolveApprovalRequest(envelope.payload);
        return null;
      case "session.snapshot":
        await this.upsertSessionSnapshot(envelope.payload);
        return null;
      case "connector.error":
        this.telemetry.error("Connector reported error", envelope.payload);
        return null;
      default:
        return null;
    }
  }
}
