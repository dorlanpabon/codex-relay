import type {
  ApprovalDecision,
  ApprovalRequest,
  DesktopStatus,
  SessionSnapshot,
} from "@codex-relay/contracts";

type InlineButton = {
  text: string;
  callback_data: string;
};

export type InlineKeyboardMarkup = {
  inline_keyboard: InlineButton[][];
};

export type TelegramAction =
  | {
      kind: "session.command";
      sessionId: string;
      command: "continue" | "pause" | "abort";
    }
  | {
      kind: "approval";
      sessionId: string;
      approvalId: string;
      decision: ApprovalDecision;
    }
  | {
      kind: "open";
      sessionId: string;
    }
  | {
      kind: "desktop.command";
      connectorId?: string;
      command:
        | "continue_active"
        | "continue_conversation"
        | "autopilot_on"
        | "autopilot_off";
      conversationId?: string;
    }
  | {
      kind: "desktop.refresh";
      connectorId?: string;
    };

export type DesktopKeyboardConversation = {
  conversationId: string;
  label: string;
};

export const buildSessionKeyboard = (sessionId: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [
      { text: "Continuar", callback_data: `continue:${sessionId}` },
      { text: "Pausar", callback_data: `pause:${sessionId}` },
    ],
    [
      { text: "Abortar", callback_data: `abort:${sessionId}` },
      { text: "Abrir panel", callback_data: `open:${sessionId}` },
    ],
  ],
});

export const buildApprovalKeyboard = (
  approval: ApprovalRequest,
): InlineKeyboardMarkup => ({
  inline_keyboard: approval.options.map((decision: ApprovalRequest["options"][number]) => [
    {
      text: decision,
      callback_data: `approve:${approval.sessionId}:${approval.approvalId}:${decision}`,
    },
  ]),
});

export const buildDesktopKeyboard = (
  status: Pick<DesktopStatus, "connectorId" | "autopilotEnabled">,
  options?: {
    primaryConversationId?: string;
    primaryContinueLabel?: string;
    conversations?: DesktopKeyboardConversation[];
  },
): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [
      {
        text: options?.primaryContinueLabel ?? "Continuar activa",
        callback_data: options?.primaryConversationId
          ? `deskc:${options.primaryConversationId}`
          : `deskcontinue:${status.connectorId}`,
      },
      {
        text: "Actualizar",
        callback_data: `deskstatus:${status.connectorId}`,
      },
    ],
    [
      {
        text: status.autopilotEnabled ? "Apagar Autopilot" : "Encender Autopilot",
        callback_data: `${status.autopilotEnabled ? "deskautooff" : "deskautoon"}:${status.connectorId}`,
      },
    ],
    ...(options?.conversations ?? []).map((conversation) => [
      {
        text: conversation.label,
        callback_data: `deskc:${conversation.conversationId}`,
      },
    ]),
  ],
});

export const formatSessionSummary = (session: SessionSnapshot): string => {
  const latest = session.latestSummary ? `\nUltimo evento: ${session.latestSummary}` : "";
  return [
    `Sesion ${session.id}`,
    `Estado: ${session.status}`,
    `Proyecto: ${session.projectId}`,
    `Auto-turnos: ${session.autoContinueTurns}/${session.autoContinuePolicy.maxAutoTurns}`,
  ].join("\n") + latest;
};

export const parseCallbackData = (input: string): TelegramAction | null => {
  if (input.startsWith("continue:")) {
    return {
      kind: "session.command",
      sessionId: input.slice("continue:".length),
      command: "continue",
    };
  }

  if (input.startsWith("pause:")) {
    return {
      kind: "session.command",
      sessionId: input.slice("pause:".length),
      command: "pause",
    };
  }

  if (input.startsWith("abort:")) {
    return {
      kind: "session.command",
      sessionId: input.slice("abort:".length),
      command: "abort",
    };
  }

  if (input.startsWith("open:")) {
    return {
      kind: "open",
      sessionId: input.slice("open:".length),
    };
  }

  if (input.startsWith("deskcontinue:")) {
    const [, connectorId] = input.split(":");
    if (!connectorId) {
      return null;
    }

    return {
      kind: "desktop.command",
      connectorId,
      command: "continue_active",
    };
  }

  if (input.startsWith("deskstatus:")) {
    return {
      kind: "desktop.refresh",
      connectorId: input.slice("deskstatus:".length),
    };
  }

  if (input.startsWith("deskc:")) {
    const conversationId = input.slice("deskc:".length);
    if (!conversationId) {
      return null;
    }

    return {
      kind: "desktop.command",
      command: "continue_conversation",
      conversationId,
    };
  }

  if (input.startsWith("deskautoon:")) {
    return {
      kind: "desktop.command",
      connectorId: input.slice("deskautoon:".length),
      command: "autopilot_on",
    };
  }

  if (input.startsWith("deskautooff:")) {
    return {
      kind: "desktop.command",
      connectorId: input.slice("deskautooff:".length),
      command: "autopilot_off",
    };
  }

  if (input.startsWith("approve:")) {
    const [, sessionId, approvalId, decision] = input.split(":");
    if (!sessionId || !approvalId || !decision) {
      return null;
    }

    if (
      decision !== "accept" &&
      decision !== "acceptForSession" &&
      decision !== "decline" &&
      decision !== "cancel"
    ) {
      return null;
    }

    return {
      kind: "approval",
      sessionId,
      approvalId,
      decision,
    };
  }

  return null;
};

export const parseRunCommand = (
  text: string,
): { repoPath: string; prompt: string } | null => {
  const match = text.match(/^\/run\s+(?:"([^"]+)"|(\S+))\s+(.+)$/s);
  const repoPath = match?.[1] ?? match?.[2];
  const prompt = match?.[3];
  if (!repoPath || !prompt) {
    return null;
  }

  return {
    repoPath,
    prompt: prompt.trim(),
  };
};
