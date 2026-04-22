import { posix as pathPosix } from "node:path";
import type { DesktopConversation, DesktopStatus } from "@codex-relay/contracts";

export type DesktopConnectorMeta = {
  machineName: string | undefined;
  projects: Array<{
    name: string;
    repoPath: string;
  }>;
};

export type DesktopConversationView = {
  index: number;
  conversationId: string;
  shortId: string;
  title: string;
  threadLabel: string;
  projectName: string | undefined;
  folderName: string | undefined;
  workspacePath: string | undefined;
  threadLine: string;
  workspaceLine: string | undefined;
  summaryLine: string | undefined;
  statusLabel: string;
  isActive: boolean;
  awaitingApproval: boolean;
  commandText: string;
  inspectCommandText: string;
  lastTurnStartedAt: string | undefined;
  lastTurnCompletedAt: string | undefined;
  lastContinueSentAt: string | undefined;
  lastContinueMode: DesktopConversation["lastContinueMode"];
};

export type DesktopStatusView = {
  machineLabel: string;
  summaryLines: string[];
  conversationViews: DesktopConversationView[];
  note: string | undefined;
};

const normalizeLookupValue = (value: string): string =>
  value.trim().toLowerCase().replace(/[_\s-]+/g, "");

export const normalizeWorkspacePath = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.endsWith("/.git") ? normalized.slice(0, -5) : normalized;
};

const shorten = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;

const folderNameFromPath = (value?: string): string | undefined => {
  const normalized = normalizeWorkspacePath(value);
  if (!normalized) {
    return undefined;
  }

  const folderName = pathPosix.basename(normalized);
  return folderName || undefined;
};

const statusLabel = (conversation: DesktopConversation): string => {
  switch (conversation.status) {
    case "running":
      return "trabajando";
    case "waiting_manual":
      return "esperando aprobacion";
    case "manual_continue_sent":
      return "continue manual enviado";
    case "auto_continue_sent":
      return "autopilot continuo";
    case "attention":
      return "requiere revision";
    default:
      return conversation.status;
  }
};

const formatDesktopTimestamp = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(parsed);
};

const buildSummaryText = (conversation: DesktopConversation): string | undefined => {
  const summary =
    conversation.lastMessagePreview ??
    conversation.note ??
    (conversation.status === "running"
      ? "Turn en progreso."
      : conversation.status === "waiting_manual"
        ? "Turn completo. Esperando aprobacion remota."
        : conversation.status === "auto_continue_sent"
          ? "Autopilot envio continue."
          : conversation.status === "manual_continue_sent"
            ? "Continue manual enviado."
            : conversation.status === "attention"
              ? "Thread requiere revision."
              : undefined);

  return summary ? shorten(summary, 112) : undefined;
};

const buildConversationLookup = (
  status: DesktopStatus,
  meta: DesktopConnectorMeta,
): DesktopConversationView[] => {
  const projects = meta.projects.map((project) => ({
    ...project,
    normalizedRepoPath: normalizeWorkspacePath(project.repoPath),
  }));

  const conversations = status.conversations.map((conversation, index) => {
    const workspacePath = normalizeWorkspacePath(conversation.workspacePath);
    const folderName = folderNameFromPath(workspacePath);
    const project = projects.find((candidate) => candidate.normalizedRepoPath === workspacePath);
    const title = project?.name || folderName || `Thread ${conversation.conversationId.slice(0, 8)}`;
    const threadLabel = conversation.threadTitle?.trim() || conversation.conversationId.slice(0, 8);

    return {
      index: index + 1,
      conversationId: conversation.conversationId,
      shortId: conversation.conversationId.slice(0, 8),
      title,
      threadLabel,
      projectName: project?.name,
      folderName,
      workspacePath,
      threadLine: `Thread: ${threadLabel}`,
      workspaceLine:
        project && folderName && normalizeLookupValue(project.name) !== normalizeLookupValue(folderName)
          ? `Carpeta: ${folderName}`
          : !project && !folderName && workspacePath
            ? `Ruta: ${shorten(workspacePath, 64)}`
            : undefined,
      summaryLine: buildSummaryText(conversation),
      statusLabel: statusLabel(conversation),
      isActive: conversation.isActive,
      awaitingApproval: conversation.awaitingApproval,
      commandText: `/desktop_continue ${index + 1}`,
      inspectCommandText: `/desktop_inspect ${index + 1}`,
      lastTurnStartedAt: conversation.lastTurnStartedAt,
      lastTurnCompletedAt: conversation.lastTurnCompletedAt,
      lastContinueSentAt: conversation.lastContinueSentAt,
      lastContinueMode: conversation.lastContinueMode,
    };
  });

  return conversations.map((conversation) => ({
    ...conversation,
    summaryLine: rewriteDesktopNote(conversation.summaryLine, conversations),
  }));
};

export const rewriteDesktopNote = (
  note: string | undefined,
  conversations: DesktopConversationView[],
): string | undefined => {
  if (!note) {
    return undefined;
  }

  return conversations.reduce(
    (current, conversation) =>
      current.split(conversation.conversationId).join(`#${conversation.index} ${conversation.title}`),
    note,
  );
};

export const buildDesktopStatusView = (
  status: DesktopStatus,
  meta: DesktopConnectorMeta,
): DesktopStatusView => {
  const conversationViews = buildConversationLookup(status, meta);
  const activeConversation = conversationViews.find(
    (conversation) => conversation.conversationId === status.activeConversationId,
  );
  const lastCompletedConversation = conversationViews.find(
    (conversation) => conversation.conversationId === status.lastCompletedConversationId,
  );

  return {
    machineLabel: meta.machineName || `Connector ${status.connectorId.slice(0, 8)}`,
    summaryLines: [
      `Companion: ${status.desktopAutomationReady ? "listo" : "no listo"}`,
      `Autopilot: ${status.autopilotEnabled ? "encendido" : "apagado"} | Auto-turnos: ${status.autoContinueCount}/${status.maxAutoTurns}`,
      activeConversation ? `Activa: #${activeConversation.index} ${activeConversation.title}` : null,
      lastCompletedConversation
        ? `Ultima completa: #${lastCompletedConversation.index} ${lastCompletedConversation.title}`
        : null,
    ].filter((line): line is string => Boolean(line)),
    conversationViews,
    note: rewriteDesktopNote(status.note, conversationViews),
  };
};

export const formatDesktopStatusText = (view: DesktopStatusView): string => {
  const conversationBlocks = view.conversationViews.slice(0, 8).map((conversation) =>
    [
      `#${conversation.index} ${conversation.title}${conversation.isActive ? " | activa" : ""}${conversation.awaitingApproval ? " | requiere accion" : ""}`,
      conversation.threadLine,
      `Estado: ${conversation.statusLabel}`,
      conversation.summaryLine ? `Ultimo estado: ${conversation.summaryLine}` : null,
      conversation.workspaceLine,
      `Acciones: ${conversation.commandText} | ${conversation.inspectCommandText}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return [
    `Codex Desktop | ${view.machineLabel}`,
    ...view.summaryLines,
    view.note ? `Nota: ${view.note}` : null,
    conversationBlocks.length ? "" : null,
    ...conversationBlocks,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
};

export const formatDesktopConversationInspectText = (
  machineLabel: string,
  conversation: DesktopConversationView,
): string =>
  [
    `Codex Desktop | ${machineLabel}`,
    `Thread #${conversation.index} ${conversation.title}`,
    conversation.threadLine,
    conversation.workspaceLine,
    conversation.workspacePath ? `Ruta: ${conversation.workspacePath}` : null,
    `Estado: ${conversation.statusLabel}`,
    conversation.summaryLine ? `Ultimo estado: ${conversation.summaryLine}` : null,
    conversation.lastTurnStartedAt
      ? `Ultimo turn iniciado: ${formatDesktopTimestamp(conversation.lastTurnStartedAt)}`
      : null,
    conversation.lastTurnCompletedAt
      ? `Ultimo turn completo: ${formatDesktopTimestamp(conversation.lastTurnCompletedAt)}`
      : null,
    conversation.lastContinueSentAt
      ? `Ultimo continue: ${formatDesktopTimestamp(conversation.lastContinueSentAt)}${conversation.lastContinueMode ? ` (${conversation.lastContinueMode})` : ""}`
      : null,
    `Acciones: ${conversation.commandText} | ${conversation.inspectCommandText}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

export const resolveDesktopConversationReference = (
  status: DesktopStatus,
  meta: DesktopConnectorMeta,
  reference: string,
): DesktopConversationView | null => {
  const normalizedReference = reference.trim();
  if (!normalizedReference) {
    return null;
  }

  const conversationViews = buildConversationLookup(status, meta);
  if (/^\d+$/.test(normalizedReference)) {
    return conversationViews[Number(normalizedReference) - 1] ?? null;
  }

  const exactIdMatch = conversationViews.find(
    (conversation) => conversation.conversationId === normalizedReference,
  );
  if (exactIdMatch) {
    return exactIdMatch;
  }

  const prefixMatches = conversationViews.filter((conversation) =>
    conversation.conversationId.startsWith(normalizedReference),
  );
  if (prefixMatches.length === 1) {
    return prefixMatches[0] ?? null;
  }

  const normalizedToken = normalizeLookupValue(normalizedReference);
  const namedMatches = conversationViews.filter((conversation) =>
    [
      conversation.title,
      conversation.threadLabel,
      conversation.folderName,
      conversation.workspacePath,
      conversation.shortId,
    ].some((value) => value && normalizeLookupValue(value) === normalizedToken),
  );

  if (namedMatches.length === 1) {
    return namedMatches[0] ?? null;
  }

  const fuzzyMatches = conversationViews.filter((conversation) =>
    [
      conversation.title,
      conversation.threadLabel,
      conversation.folderName,
      conversation.workspacePath,
      conversation.shortId,
    ].some((value) => {
      if (!value) {
        return false;
      }

      const normalizedValue = normalizeLookupValue(value);
      return normalizedValue.includes(normalizedToken) || normalizedToken.includes(normalizedValue);
    }),
  );

  return fuzzyMatches.length === 1 ? fuzzyMatches[0] ?? null : null;
};
