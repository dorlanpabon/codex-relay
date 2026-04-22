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
  folderName: string | undefined;
  workspacePath: string | undefined;
  contextLine: string | undefined;
  detailLine: string | undefined;
  statusLabel: string;
  isActive: boolean;
  awaitingApproval: boolean;
  commandText: string;
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
  value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;

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

    return {
      index: index + 1,
      conversationId: conversation.conversationId,
      shortId: conversation.conversationId.slice(0, 8),
      title,
      folderName,
      workspacePath,
      contextLine:
        project && folderName && normalizeLookupValue(project.name) !== normalizeLookupValue(folderName)
          ? `Carpeta: ${folderName}`
          : !project && !folderName && workspacePath
            ? `Ruta: ${shorten(workspacePath, 48)}`
            : undefined,
      detailLine:
        conversation.awaitingApproval || conversation.status === "attention"
          ? conversation.note
          : undefined,
      statusLabel: statusLabel(conversation),
      isActive: conversation.isActive,
      awaitingApproval: conversation.awaitingApproval,
      commandText: `/desktop_continue ${index + 1}`,
    };
  });

  const titleCounts = conversations.reduce(
    (counts, conversation) => counts.set(conversation.title, (counts.get(conversation.title) ?? 0) + 1),
    new Map<string, number>(),
  );

  return conversations.map((conversation) => ({
    ...conversation,
    contextLine:
      conversation.contextLine ??
      ((titleCounts.get(conversation.title) ?? 0) > 1 ? `Thread: ${conversation.shortId}` : undefined),
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
      `Estado: ${conversation.statusLabel}`,
      conversation.contextLine,
      conversation.detailLine ? `Detalle: ${rewriteDesktopNote(conversation.detailLine, view.conversationViews)}` : null,
      `Accion: ${conversation.commandText}`,
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
      conversation.folderName,
      conversation.workspacePath,
      conversation.shortId,
    ].some((value) => value && normalizeLookupValue(value) === normalizedToken),
  );

  return namedMatches.length === 1 ? namedMatches[0] ?? null : null;
};
