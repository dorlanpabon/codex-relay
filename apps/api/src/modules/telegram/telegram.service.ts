import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import type { Prisma } from "@prisma/client";
import {
  buildApprovalKeyboard,
  buildDesktopKeyboard,
  buildSessionKeyboard,
  parseCallbackData,
  parseRunCommand,
} from "@codex-relay/telegram";
import type { ApprovalDecision, DesktopStatus } from "@codex-relay/contracts";

import { loadConfig } from "../../config.js";
import { CommandsService } from "../commands/commands.service.js";
import { ConnectorHubService } from "../connectors/connector-hub.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { TelemetryService } from "../telemetry/telemetry.service.js";
import { TasksService } from "../tasks/tasks.service.js";
import { normalizeTelegramCommandInput } from "./command-normalizer.js";

type TelegramUpdate = {
  update_id: number;
  message?: {
    chat: {
      id: number;
    };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      chat: {
        id: number;
      };
    };
  };
};

type TelegramSendMessageOptions = {
  reply_markup?: unknown;
};

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly config = loadConfig();
  private running = false;
  private offset = 0;
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly commandsService: CommandsService,
    private readonly connectorHub: ConnectorHubService,
    private readonly telemetry: TelemetryService,
  ) {}

  onModuleInit(): void {
    if (!this.config.TELEGRAM_BOT_TOKEN) {
      this.telemetry.log("Telegram bot disabled");
      return;
    }

    this.running = true;
    this.startQueueWorker();
    void this.pollLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    await this.worker?.close();
  }

  private startQueueWorker(): void {
    try {
      this.worker = new Worker(
        "telegram-notifications",
        async (job) => {
          switch (job.name) {
            case "approval-requested":
              await this.sendApprovalNotification(String(job.data.approvalId));
              break;
            case "session-needs-attention":
              await this.sendAttentionNotification(
                String(job.data.sessionId),
                String(job.data.reason),
                String(job.data.summary),
              );
              break;
            case "desktop-awaiting-approval":
              await this.sendDesktopAwaitingApprovalNotification(
                String(job.data.connectorId),
                String(job.data.conversationId),
                String(job.data.note),
              );
              break;
            case "desktop-continue-sent":
              await this.sendDesktopContinueSentNotification(
                String(job.data.connectorId),
                String(job.data.conversationId),
                String(job.data.note),
              );
              break;
            default:
              this.telemetry.warn("Unhandled telegram job", { name: job.name });
          }
        },
        {
          connection: {
            url: this.config.REDIS_URL,
          },
        },
      );

      this.worker.on("failed", (job, error) => {
        this.telemetry.error("Telegram worker failed", {
          jobId: job?.id,
          error: error.message,
        });
      });
    } catch (error) {
      this.telemetry.warn("Telegram worker disabled", {
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      } catch (error) {
        this.telemetry.warn("Telegram poll loop failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
      }

      await new Promise((resolve) =>
        setTimeout(resolve, this.config.TELEGRAM_POLL_INTERVAL_MS),
      );
    }
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const response = await this.telegramRequest<{ result: TelegramUpdate[] }>(
      "getUpdates",
      {
        offset: this.offset,
        timeout: 15,
        allowed_updates: ["message", "callback_query"],
      },
    );

    return response.result;
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.message?.text) {
      await this.handleMessage(update.message.chat.id, update.message.text);
      return;
    }

    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
    }
  }

  private async handleMessage(chatId: number, text: string): Promise<void> {
    const normalizedText = normalizeTelegramCommandInput(text);

    if (normalizedText.startsWith("/start")) {
      await this.bindChat(chatId);
      await this.sendMessage(
        chatId,
        [
          "Codex Relay enlazado.",
          "Usa /run <ruta> <prompt> para lanzar tareas.",
          "Usa /sessions para ver las ultimas sesiones.",
          "Usa /desktop_status y /desktop_continue [connectorId] [conversationId] para controlar Codex Desktop.",
        ].join("\n"),
      );
      return;
    }

    const userId = await this.resolveAuthorizedUser(chatId);
    if (!userId) {
      await this.sendMessage(chatId, "Este chat no esta enlazado. Envia /start primero.");
      return;
    }

    if (normalizedText === "/sessions") {
      await this.sendSessionsDigest(chatId, userId);
      return;
    }

    if (normalizedText.startsWith("/desktop_status")) {
      await this.handleDesktopStatusCommand(chatId, userId, normalizedText);
      return;
    }

    if (normalizedText.startsWith("/desktop_continue")) {
      await this.handleDesktopCommand(chatId, userId, normalizedText, "continue_active");
      return;
    }

    if (normalizedText.startsWith("/desktop_auto_on")) {
      await this.handleDesktopCommand(chatId, userId, normalizedText, "autopilot_on");
      return;
    }

    if (normalizedText.startsWith("/desktop_auto_off")) {
      await this.handleDesktopCommand(chatId, userId, normalizedText, "autopilot_off");
      return;
    }

    if (normalizedText.startsWith("/run ")) {
      await this.handleRunCommand(chatId, userId, normalizedText);
      return;
    }

    if (normalizedText.startsWith("/continue ")) {
      await this.handleDirectSessionCommand(chatId, userId, normalizedText, "continue");
      return;
    }

    if (normalizedText.startsWith("/pause ")) {
      await this.handleDirectSessionCommand(chatId, userId, normalizedText, "pause");
      return;
    }

    if (normalizedText.startsWith("/abort ")) {
      await this.handleDirectSessionCommand(chatId, userId, normalizedText, "abort");
      return;
    }

    await this.sendMessage(
      chatId,
      "Comando no reconocido. Usa /run, /sessions, /continue, /pause o /abort.",
    );
  }

  private async handleCallbackQuery(query: NonNullable<TelegramUpdate["callback_query"]>) {
    const chatId = query.message?.chat.id;
    if (!chatId || !query.data) {
      return;
    }

    const userId = await this.resolveAuthorizedUser(chatId);
    if (!userId) {
      await this.answerCallbackQuery(query.id, "Chat no enlazado");
      return;
    }

    const action = parseCallbackData(query.data);
    if (!action) {
      await this.answerCallbackQuery(query.id, "Accion invalida");
      return;
    }

    if (action.kind === "open") {
      await this.sendMessage(
        chatId,
        `${this.config.WEB_BASE_URL}/sessions/${action.sessionId}`,
      );
      await this.answerCallbackQuery(query.id, "Abriendo panel");
      return;
    }

    if (action.kind === "approval") {
      await this.issueCommand(userId, {
        sessionId: action.sessionId,
        command: "approve_once",
        approvalId: action.approvalId,
        decision: action.decision,
      });
      await this.answerCallbackQuery(query.id, `Approval ${action.decision}`);
      return;
    }

    if (action.kind === "desktop.command") {
      await this.issueDesktopCommand(userId, {
        command: action.command,
        ...(action.connectorId ? { connectorId: action.connectorId } : {}),
        ...(action.conversationId ? { conversationId: action.conversationId } : {}),
      });
      await this.answerCallbackQuery(
        query.id,
        action.conversationId
          ? `Desktop ${action.command} ${action.conversationId.slice(0, 8)}`
          : `Desktop ${action.command} enviado`,
      );
      return;
    }

    await this.issueCommand(userId, {
      sessionId: action.sessionId,
      command: action.command,
    });
    await this.answerCallbackQuery(query.id, `Comando ${action.command} enviado`);
  }

  private async handleRunCommand(
    chatId: number,
    userId: string,
    text: string,
  ): Promise<void> {
    const parsed = parseRunCommand(text);
    if (!parsed) {
      await this.sendMessage(
        chatId,
        'Formato invalido. Usa /run "D:\\repo" corrige el bug',
      );
      return;
    }

    const project = await this.prisma.project.findFirst({
      where: {
        connector: {
          ownerId: userId,
        },
        repoPath: parsed.repoPath,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (!project) {
      const knownProjects = await this.prisma.project.findMany({
        where: {
          connector: {
            ownerId: userId,
          },
        },
        orderBy: {
          name: "asc",
        },
      });

      await this.sendMessage(
        chatId,
        [
          `No encontre un proyecto emparejado para ${parsed.repoPath}.`,
          "Rutas conocidas:",
          knownProjects.map((item) => `- ${item.repoPath}`).join("\n") || "- ninguna",
        ].join("\n"),
      );
      return;
    }

    const session = await this.tasksService.createTask(userId, {
      projectId: project.id,
      repoPath: project.repoPath,
      prompt: parsed.prompt,
      threadMode: "new",
      autoContinuePolicy: {
        mode: "safe",
        maxAutoTurns: 5,
        continuePrompt:
          "Continua hasta terminar. Solo detente si necesitas una decision real, credenciales externas, o una aclaracion imposible de inferir.",
      },
    });

    await this.sendMessage(
      chatId,
      `Sesion ${session.id} creada para ${project.name}.`,
      {
        reply_markup: buildSessionKeyboard(session.id),
      },
    );
  }

  private async handleDirectSessionCommand(
    chatId: number,
    userId: string,
    text: string,
    command: "continue" | "pause" | "abort",
  ): Promise<void> {
    const sessionId = text.split(/\s+/)[1];
    if (!sessionId) {
      await this.sendMessage(chatId, `Falta sessionId. Usa /${command} <sessionId>.`);
      return;
    }

    await this.issueCommand(userId, {
      sessionId,
      command,
    });
    await this.sendMessage(chatId, `Comando ${command} enviado a ${sessionId}.`);
  }

  private async issueCommand(
    userId: string,
    payload: {
      sessionId: string;
      command: "continue" | "pause" | "abort" | "approve_once";
      approvalId?: string;
      decision?: ApprovalDecision;
    },
  ): Promise<void> {
    const command = await this.commandsService.createUserCommand(userId, payload);
    await this.connectorHub.dispatchQueuedCommand(command.session.connectorId, command);
  }

  private async issueDesktopCommand(
    userId: string,
    payload: {
      connectorId?: string;
      command:
        | "continue_active"
        | "continue_conversation"
        | "autopilot_on"
        | "autopilot_off";
      conversationId?: string;
      maxAutoTurns?: number;
    },
  ): Promise<void> {
    await this.connectorHub.dispatchDesktopCommand(userId, payload);
  }

  private async handleDesktopStatusCommand(
    chatId: number,
    userId: string,
    text: string,
  ): Promise<void> {
    const connectorId = text.split(/\s+/)[1];
    const status = this.connectorHub.getDesktopStatus(userId, connectorId);
    if (!status) {
      await this.sendMessage(chatId, "No encontre un desktop companion activo.");
      return;
    }

    await this.sendMessage(chatId, this.formatDesktopStatus(status), {
      reply_markup: buildDesktopKeyboard(
        status,
        status.conversations.find((conversation) => conversation.awaitingApproval)?.conversationId,
      ),
    });
  }

  private async handleDesktopCommand(
    chatId: number,
    userId: string,
    text: string,
    command:
      | "continue_active"
      | "continue_conversation"
      | "autopilot_on"
      | "autopilot_off",
  ): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const connectorCandidate = parts[1];
    const secondCandidate = parts[2];

    let effectiveCommand = command;
    let connectorId: string | undefined;
    let conversationId: string | undefined;
    let maxAutoTurns: number | undefined;

    if (command === "continue_active" || command === "continue_conversation") {
      if (connectorCandidate && secondCandidate) {
        connectorId = connectorCandidate;
        conversationId = secondCandidate;
        effectiveCommand = "continue_conversation";
      } else if (connectorCandidate) {
        const exactConnector = this.connectorHub.getDesktopStatus(userId, connectorCandidate);
        if (exactConnector) {
          connectorId = connectorCandidate;
        } else {
          conversationId = connectorCandidate;
          effectiveCommand = "continue_conversation";
        }
      }
    } else {
      const numeric = /^\d+$/.test(secondCandidate ?? "")
        ? Number(secondCandidate)
        : /^\d+$/.test(connectorCandidate ?? "")
          ? Number(connectorCandidate)
          : undefined;
      maxAutoTurns = numeric && numeric > 0 ? numeric : undefined;
      connectorId =
        connectorCandidate && !/^\d+$/.test(connectorCandidate) ? connectorCandidate : undefined;
    }

    await this.issueDesktopCommand(userId, {
      command: effectiveCommand,
      ...(connectorId ? { connectorId } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(maxAutoTurns ? { maxAutoTurns } : {}),
    });

    await this.sendMessage(
      chatId,
      conversationId
        ? `Comando ${effectiveCommand} enviado para ${conversationId}.`
        : `Comando ${effectiveCommand} enviado al desktop companion.`,
    );
  }

  private async sendSessionsDigest(chatId: number, userId: string): Promise<void> {
    const sessions = await this.prisma.session.findMany({
      where: {
        ownerId: userId,
      },
      include: {
        project: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 5,
    });

    if (!sessions.length) {
      await this.sendMessage(chatId, "No hay sesiones registradas.");
      return;
    }

    await this.sendMessage(
      chatId,
      sessions
        .map(
          (session) =>
            [
              `${session.id} · ${session.project.name}`,
              `Estado: ${session.status}`,
              `Auto-turnos: ${session.autoContinueTurns}/${session.autoContinueMaxTurns}`,
              session.latestSummary ? `Ultimo: ${session.latestSummary}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
        )
        .join("\n\n"),
    );
  }

  private async sendApprovalNotification(approvalId: string): Promise<void> {
    const approval = await this.prisma.approvalRequest.findUnique({
      where: { id: approvalId },
      include: {
        session: {
          include: {
            owner: true,
            project: true,
          },
        },
      },
    });

    if (!approval?.session.owner.telegramChatId) {
      return;
    }

    await this.sendMessage(
      Number(approval.session.owner.telegramChatId),
      [
        `Aprobacion pendiente en ${approval.session.project.name}`,
        approval.message,
        `Sesion: ${approval.sessionId}`,
      ].join("\n"),
      {
        reply_markup: buildApprovalKeyboard({
          approvalId: approval.id,
          sessionId: approval.sessionId,
          kind: approval.kind as ApprovalRequestKindFromDb,
          message: approval.message,
          options: approval.options as ApprovalOptionsFromDb,
        }),
      },
    );
  }

  private async sendAttentionNotification(
    sessionId: string,
    reason: string,
    summary: string,
  ): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        owner: true,
        project: true,
      },
    });

    if (!session?.owner.telegramChatId) {
      return;
    }

    await this.sendMessage(
      Number(session.owner.telegramChatId),
      [
        `Sesion requiere atencion: ${session.project.name}`,
        `Motivo: ${reason}`,
        `Resumen: ${summary}`,
        `Sesion: ${sessionId}`,
      ].join("\n"),
      {
        reply_markup: buildSessionKeyboard(sessionId),
      },
    );
  }

  private async sendDesktopAwaitingApprovalNotification(
    connectorId: string,
    conversationId: string,
    note: string,
  ): Promise<void> {
    const status = this.connectorHub.getDesktopStatus(this.config.DEFAULT_USER_ID, connectorId);
    if (!status) {
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: this.config.DEFAULT_USER_ID },
      select: {
        telegramChatId: true,
      },
    });

    if (!user?.telegramChatId) {
      return;
    }

    const conversation = status.conversations.find(
      (item) => item.conversationId === conversationId,
    );

    await this.sendMessage(
      Number(user.telegramChatId),
      [
        `Codex Desktop requiere aprobacion en ${connectorId}.`,
        `Conversacion: ${conversationId}`,
        note,
        conversation?.lastTurnCompletedAt
          ? `Ultimo turn complete: ${conversation.lastTurnCompletedAt}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
      {
        reply_markup: buildDesktopKeyboard(status, conversationId),
      },
    );
  }

  private async sendDesktopContinueSentNotification(
    connectorId: string,
    conversationId: string,
    note: string,
  ): Promise<void> {
    const status = this.connectorHub.getDesktopStatus(this.config.DEFAULT_USER_ID, connectorId);
    if (!status) {
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: this.config.DEFAULT_USER_ID },
      select: {
        telegramChatId: true,
      },
    });

    if (!user?.telegramChatId) {
      return;
    }

    const conversation = status.conversations.find(
      (item) => item.conversationId === conversationId,
    );

    await this.sendMessage(
      Number(user.telegramChatId),
      [
        `Autopilot continuo ${conversationId} en ${connectorId}.`,
        note,
        conversation?.lastContinueSentAt
          ? `Continue enviado: ${conversation.lastContinueSentAt}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  private async bindChat(chatId: number): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: this.config.DEFAULT_USER_ID },
      update: {
        telegramChatId: String(chatId),
      },
      create: {
        id: this.config.DEFAULT_USER_ID,
        telegramChatId: String(chatId),
      },
    });
  }

  private async resolveAuthorizedUser(chatId: number): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        telegramChatId: String(chatId),
      },
      select: {
        id: true,
      },
    });

    return user?.id ?? null;
  }

  private async sendMessage(
    chatId: number,
    text: string,
    options?: TelegramSendMessageOptions,
  ): Promise<void> {
    await this.telegramRequest("sendMessage", {
      chat_id: chatId,
      text,
      ...(options?.reply_markup ? { reply_markup: options.reply_markup } : {}),
    });
  }

  private async answerCallbackQuery(id: string, text: string): Promise<void> {
    await this.telegramRequest("answerCallbackQuery", {
      callback_query_id: id,
      text,
    });
  }

  private formatDesktopStatus(status: DesktopStatus): string {
    const conversations = status.conversations
      .slice(0, 6)
      .map((conversation) =>
        [
          `- ${conversation.conversationId}${conversation.isActive ? " (activa)" : ""}`,
          `estado=${conversation.status}`,
          conversation.awaitingApproval ? "approval=pending" : null,
          conversation.autoContinueCount ? `auto=${conversation.autoContinueCount}` : null,
        ]
          .filter(Boolean)
          .join(" | "),
      );

    return [
      `Desktop connector: ${status.connectorId}`,
      `Listo: ${status.desktopAutomationReady ? "si" : "no"}`,
      `Autopilot: ${status.autopilotEnabled ? "encendido" : "apagado"}`,
      `Auto-turnos: ${status.autoContinueCount}/${status.maxAutoTurns}`,
      status.activeConversationId ? `Conversacion activa: ${status.activeConversationId}` : null,
      status.lastCompletedConversationId
        ? `Ultima completa: ${status.lastCompletedConversationId}`
        : null,
      status.note ? `Nota: ${status.note}` : null,
      conversations.length ? "Conversaciones:" : null,
      ...conversations,
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async telegramRequest<T = unknown>(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.config.TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Telegram API ${method} failed with ${response.status}: ${bodyText || "empty_response"}`,
      );
    }

    return JSON.parse(bodyText) as T;
  }
}

type ApprovalRequestKindFromDb =
  | "commandExecution"
  | "fileChange"
  | "toolInput"
  | "network";

type ApprovalOptionsFromDb = Array<
  "accept" | "acceptForSession" | "decline" | "cancel"
>;
