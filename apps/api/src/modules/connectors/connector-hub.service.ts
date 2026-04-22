import { ConflictException, Inject, Injectable, NotFoundException, forwardRef } from "@nestjs/common";
import type { Server } from "node:http";
import { URL } from "node:url";
import {
  ConnectorEventEnvelopeSchema,
  type ConnectorCommandEnvelope,
  type ConnectorHello,
  type DesktopCommand,
  type DesktopStatus,
} from "@codex-relay/contracts";
import type { Command, Session } from "@prisma/client";
import WebSocket, { WebSocketServer } from "ws";

import { CommandsService } from "../commands/commands.service.js";
import { PairingService } from "../pairing/pairing.service.js";
import { QueueService } from "../queue/queue.service.js";
import { SessionsService } from "../sessions/sessions.service.js";
import { TelemetryService } from "../telemetry/telemetry.service.js";

type ConnectedClient = {
  ownerId: string;
  socket: WebSocket;
};

type DesktopStateEntry = {
  ownerId: string;
  state: DesktopStatus;
};

type CommandWithSession = Command & {
  session: Session;
};

@Injectable()
export class ConnectorHubService {
  private readonly clients = new Map<string, ConnectedClient>();
  private readonly desktopStates = new Map<string, DesktopStateEntry>();
  private serverAttached = false;

  constructor(
    private readonly pairingService: PairingService,
    private readonly sessionsService: SessionsService,
    @Inject(forwardRef(() => CommandsService))
    private readonly commandsService: CommandsService,
    private readonly queue: QueueService,
    private readonly telemetry: TelemetryService
  ) {}

  attachServer(server: Server): void {
    if (this.serverAttached) {
      return;
    }

    const wsServer = new WebSocketServer({ noServer: true });

    server.on("upgrade", async (request, socket, head) => {
      const url = new URL(request.url ?? "", "http://localhost");
      if (url.pathname !== "/connectors") {
        return;
      }

      const connectorId = url.searchParams.get("connectorId");
      const token = url.searchParams.get("token");
      if (!connectorId || !token) {
        socket.destroy();
        return;
      }

      try {
        const ownerId = await this.pairingService.validatePairing(connectorId, token);
        wsServer.handleUpgrade(request, socket, head, (client: WebSocket) => {
          wsServer.emit("connection", client, request, {
            connectorId,
            ownerId
          });
        });
      } catch (error) {
        this.telemetry.warn("Connector auth failed", {
          connectorId,
          error: error instanceof Error ? error.message : "unknown_error"
        });
        socket.destroy();
      }
    });

    wsServer.on(
      "connection",
      (
        socket: WebSocket,
        _request: unknown,
        context: { connectorId: string; ownerId: string }
      ) => {
        this.clients.set(context.connectorId, {
          ownerId: context.ownerId,
          socket
        });

        socket.on("message", async (buffer: WebSocket.RawData) => {
          const parsed = ConnectorEventEnvelopeSchema.parse(
            JSON.parse(buffer.toString())
          );

          if (parsed.type === "connector.hello") {
            await this.handleHello(context.ownerId, context.connectorId, parsed.payload);
            return;
          }

          if (parsed.type === "desktop.status") {
            await this.handleDesktopStatus(context.ownerId, context.connectorId, parsed.payload);
            return;
          }

          const automation = await this.sessionsService.handleConnectorEnvelope(parsed);
          if (automation?.shouldAutoContinue) {
            const command = await this.commandsService.createSystemContinue(
              automation.sessionId
            );
            await this.dispatchQueuedCommand(context.connectorId, command);
          }
        });

        socket.on("close", () => {
          const current = this.clients.get(context.connectorId);
          if (current?.socket !== socket) {
            return;
          }

          this.clients.delete(context.connectorId);
          const desktop = this.desktopStates.get(context.connectorId);
          if (desktop) {
            this.desktopStates.set(context.connectorId, {
              ...desktop,
              state: {
                ...desktop.state,
                connected: false,
                note: "Connector desconectado.",
              },
            });
          }
        });
      }
    );

    this.serverAttached = true;
  }

  async dispatchQueuedCommand(
    connectorId: string,
    command: CommandWithSession
  ): Promise<void> {
    return this.dispatchEnvelope(
      connectorId,
      this.commandsService.toEnvelope(command),
      command.id,
    );
  }

  private async dispatchEnvelope(
    connectorId: string,
    envelope: ConnectorCommandEnvelope,
    commandId?: string,
  ): Promise<void> {
    const client = this.clients.get(connectorId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      client.socket.send(JSON.stringify(envelope));
      if (commandId) {
        await this.commandsService.markSent(commandId);
      }
    } catch (error) {
      if (commandId) {
        await this.commandsService.markFailed(
          commandId,
          error instanceof Error ? error.message : "dispatch_failed"
        );
      }
    }
  }

  getDesktopStatus(ownerId: string, connectorId?: string): DesktopStatus | null {
    return this.resolveDesktopState(ownerId, connectorId)?.state ?? null;
  }

  async dispatchDesktopCommand(ownerId: string, payload: DesktopCommand): Promise<void> {
    const target = this.resolveDesktopState(ownerId, payload.connectorId);
    if (!target) {
      throw new NotFoundException("Desktop companion not found");
    }

    const client = this.clients.get(target.state.connectorId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      throw new ConflictException("Target connector is not connected");
    }

    await this.dispatchEnvelope(target.state.connectorId, {
      type: "desktop.command",
      payload: {
        ...payload,
        connectorId: target.state.connectorId,
      },
    });
  }

  async flushQueuedCommands(connectorId: string): Promise<void> {
    const commands = await this.commandsService.listQueuedCommands(connectorId);
    for (const command of commands) {
      await this.dispatchQueuedCommand(connectorId, command);
    }
  }

  private async handleHello(
    ownerId: string,
    connectorId: string,
    hello: ConnectorHello,
  ): Promise<void> {
    await this.pairingService.applyHello(ownerId, hello);
    this.upsertDesktopState(ownerId, connectorId, {
      connectorId,
      connected: true,
      desktopAutomationReady: hello.desktopAutomationReady,
      note: hello.desktopAutomationReady
        ? "Desktop companion conectado."
        : "Desktop companion no listo.",
    });
    await this.restoreRecoverableSessions(ownerId, connectorId);
    await this.flushQueuedCommands(connectorId);
  }

  private async handleDesktopStatus(
    ownerId: string,
    connectorId: string,
    status: DesktopStatus,
  ): Promise<void> {
    const previous = this.desktopStates.get(connectorId)?.state;
    this.upsertDesktopState(ownerId, connectorId, {
      ...status,
      connectorId,
      connected: true,
    });

    const next = this.desktopStates.get(connectorId)?.state;
    if (next) {
      await this.enqueueDesktopConversationNotifications(connectorId, previous, next);
    }
  }

  private async restoreRecoverableSessions(
    ownerId: string,
    connectorId: string,
  ): Promise<void> {
    const recoverableSessions = await this.sessionsService.listRecoverableSessions(
      ownerId,
      connectorId,
    );

    for (const session of recoverableSessions) {
      await this.dispatchEnvelope(connectorId, {
        type: "session.resume",
        sessionId: session.sessionId,
        payload: session.payload,
      });
    }
  }

  private resolveDesktopState(
    ownerId: string,
    connectorId?: string,
  ): DesktopStateEntry | null {
    if (connectorId) {
      const exact = this.desktopStates.get(connectorId);
      return exact?.ownerId === ownerId ? exact : null;
    }

    for (const entry of this.desktopStates.values()) {
      if (entry.ownerId === ownerId && entry.state.connected) {
        return entry;
      }
    }

    for (const entry of this.desktopStates.values()) {
      if (entry.ownerId === ownerId) {
        return entry;
      }
    }

    return null;
  }

  private upsertDesktopState(
    ownerId: string,
    connectorId: string,
    state: Partial<DesktopStatus>,
  ): void {
    const previous = this.desktopStates.get(connectorId)?.state;
    const conversations = state.conversations ?? previous?.conversations ?? [];
    const activeConversationId =
      state.activeConversationId ??
      previous?.activeConversationId ??
      conversations.find((conversation) => conversation.isActive)?.conversationId;
    const latestCompletedConversation = [...conversations]
      .filter((conversation) => conversation.lastTurnCompletedAt)
      .sort((left, right) =>
        Date.parse(right.lastTurnCompletedAt ?? "") - Date.parse(left.lastTurnCompletedAt ?? ""),
      )[0];
    const lastCompletedConversationId =
      state.lastCompletedConversationId ??
      previous?.lastCompletedConversationId ??
      latestCompletedConversation?.conversationId;
    const lastTurnCompletedAt =
      state.lastTurnCompletedAt ??
      previous?.lastTurnCompletedAt ??
      latestCompletedConversation?.lastTurnCompletedAt;
    const desktopAutomationReady =
      (state.desktopAutomationReady ?? previous?.desktopAutomationReady ?? false) ||
      Boolean(
        activeConversationId ||
          lastCompletedConversationId ||
          lastTurnCompletedAt ||
          conversations.length,
      );
    const noteCandidate = state.note ?? previous?.note;

    this.desktopStates.set(connectorId, {
      ownerId,
      state: {
        connectorId,
        connected: state.connected ?? previous?.connected ?? true,
        desktopAutomationReady,
        autopilotEnabled: state.autopilotEnabled ?? previous?.autopilotEnabled ?? false,
        maxAutoTurns: state.maxAutoTurns ?? previous?.maxAutoTurns ?? 5,
        autoContinueCount:
          state.autoContinueCount ??
          previous?.autoContinueCount ??
          conversations.reduce(
            (total, conversation) => total + conversation.autoContinueCount,
            0,
          ),
        conversations,
        activeConversationId,
        lastCompletedConversationId,
        lastTurnCompletedAt,
        note:
          desktopAutomationReady && noteCandidate === "Desktop companion no listo."
            ? "Desktop companion activo."
            : noteCandidate,
      },
    });
  }

  private async enqueueDesktopConversationNotifications(
    connectorId: string,
    previous: DesktopStatus | undefined,
    next: DesktopStatus,
  ): Promise<void> {
    const previousConversations = new Map(
      (previous?.conversations ?? []).map((conversation) => [
        conversation.conversationId,
        conversation,
      ]),
    );

    for (const conversation of next.conversations) {
      const previousConversation = previousConversations.get(conversation.conversationId);

      if (
        conversation.lastContinueMode === "autopilot" &&
        conversation.lastContinueSentAt &&
        conversation.lastContinueSentAt !== previousConversation?.lastContinueSentAt
      ) {
        await this.queue.enqueueTelegramNotification("desktop-continue-sent", {
          connectorId,
          conversationId: conversation.conversationId,
          note: conversation.note ?? next.note ?? "Autopilot envio continue.",
          timestamp: conversation.lastContinueSentAt,
        });
      }

      if (
        conversation.awaitingApproval &&
        conversation.lastTurnCompletedAt &&
        conversation.lastTurnCompletedAt !== previousConversation?.lastTurnCompletedAt &&
        (conversation.status === "waiting_manual" || conversation.status === "attention")
      ) {
        await this.queue.enqueueTelegramNotification("desktop-awaiting-approval", {
          connectorId,
          conversationId: conversation.conversationId,
          note: conversation.note ?? next.note ?? "Codex Desktop requiere aprobacion.",
          timestamp: conversation.lastTurnCompletedAt,
        });
      }
    }
  }
}
