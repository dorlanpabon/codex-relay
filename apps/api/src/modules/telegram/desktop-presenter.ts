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
  hasMeaningfulThreadLabel: boolean;
  projectName: string | undefined;
  folderName: string | undefined;
  workspacePath: string | undefined;
  threadLine: string;
  workspaceLine: string | undefined;
  summaryLine: string | undefined;
  statusLabel: string;
  isActive: boolean;
  awaitingApproval: boolean;
  hasWorkingSource: boolean;
  hasInactiveSource: boolean;
  hasPendingSource: boolean;
  hiddenDuplicateCount: number;
  sourceConversationIds: string[];
  sourceShortIds: string[];
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
  filter: DesktopStatusFilter;
  totalConversationCount: number;
};

export type DesktopStatusFilter = "priority" | "working" | "inactive" | "pending" | "all";

type ConversationSeed = Omit<
  DesktopConversationView,
  "index" | "commandText" | "inspectCommandText" | "summaryLine"
> & {
  summaryLineRaw: string | undefined;
};

const normalizeLookupValue = (value: string): string =>
  value.trim().toLowerCase().replace(/[_\s-]+/g, "");

const DESKTOP_STATUS_FILTER_ALIASES: Record<string, DesktopStatusFilter> = {
  all: "all",
  todos: "all",
  todo: "all",
  working: "working",
  work: "working",
  activos: "working",
  activo: "working",
  trabajando: "working",
  running: "working",
  inactive: "inactive",
  inactivos: "inactive",
  inactivo: "inactive",
  idle: "inactive",
  pending: "pending",
  pendientes: "pending",
  pendiente: "pending",
  waiting: "pending",
  manual: "pending",
  default: "priority",
  prioridad: "priority",
  priority: "priority",
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

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

const isWorkingStatusLabel = (value: string): boolean =>
  value === "trabajando" ||
  value === "continue manual enviado" ||
  value === "autopilot continuo";

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

export const parseDesktopStatusFilter = (
  value?: string,
): DesktopStatusFilter | null => {
  if (!value) {
    return null;
  }

  return DESKTOP_STATUS_FILTER_ALIASES[value.trim().toLowerCase()] ?? null;
};

const desktopStatusFilterLabel = (filter: DesktopStatusFilter): string => {
  switch (filter) {
    case "all":
      return "todos";
    case "working":
      return "trabajando";
    case "inactive":
      return "inactivos";
    case "pending":
      return "pendientes";
    default:
      return "prioridad";
  }
};

const parseTimestamp = (value?: string): number => {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const isMeaningfulThreadLabel = (conversation: DesktopConversation): boolean => {
  const value = conversation.threadTitle?.trim();
  if (!value) {
    return false;
  }

  const normalized = normalizeLookupValue(value);
  if (!normalized) {
    return false;
  }

  const shortId = conversation.conversationId.slice(0, 8).toLowerCase();
  const normalizedConversationId = normalizeLookupValue(conversation.conversationId);
  return (
    normalized !== shortId &&
    normalized !== normalizedConversationId &&
    !/^thread[0-9a-f]{8,}$/i.test(normalized)
  );
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

  return summary ? shorten(summary, 140) : undefined;
};

const latestActivityTimestamp = (conversation: ConversationSeed): number =>
  Math.max(
    parseTimestamp(conversation.lastTurnCompletedAt),
    parseTimestamp(conversation.lastContinueSentAt),
    parseTimestamp(conversation.lastTurnStartedAt),
  );

const compareRepresentativePriority = (
  left: ConversationSeed,
  right: ConversationSeed,
): number => {
  const activeDiff = Number(right.isActive) - Number(left.isActive);
  if (activeDiff !== 0) {
    return activeDiff;
  }

  const approvalDiff = Number(right.awaitingApproval) - Number(left.awaitingApproval);
  if (approvalDiff !== 0) {
    return approvalDiff;
  }

  const activityDiff = latestActivityTimestamp(right) - latestActivityTimestamp(left);
  if (activityDiff !== 0) {
    return activityDiff;
  }

  return left.conversationId.localeCompare(right.conversationId);
};

const compareDisplayPriority = (left: ConversationSeed, right: ConversationSeed): number => {
  const approvalDiff = Number(right.awaitingApproval) - Number(left.awaitingApproval);
  if (approvalDiff !== 0) {
    return approvalDiff;
  }

  const activeDiff = Number(right.isActive) - Number(left.isActive);
  if (activeDiff !== 0) {
    return activeDiff;
  }

  const activityDiff = latestActivityTimestamp(right) - latestActivityTimestamp(left);
  if (activityDiff !== 0) {
    return activityDiff;
  }

  return left.title.localeCompare(right.title);
};

const buildConversationGroupKey = (conversation: ConversationSeed): string =>
  conversation.workspacePath
    ? `workspace:${normalizeLookupValue(conversation.workspacePath)}`
    : conversation.projectName
      ? `project:${normalizeLookupValue(conversation.projectName)}`
      : conversation.folderName
        ? `folder:${normalizeLookupValue(conversation.folderName)}`
        : `conversation:${conversation.conversationId}`;

const chooseRepresentative = (conversations: ConversationSeed[]): ConversationSeed =>
  [...conversations].sort(compareRepresentativePriority)[0]!;

const createConversationSeed = (
  conversation: DesktopConversation,
  projects: Array<{
    name: string;
    repoPath: string;
    normalizedRepoPath: string | undefined;
  }>,
): ConversationSeed => {
  const workspacePath = normalizeWorkspacePath(conversation.workspacePath);
  const folderName = folderNameFromPath(workspacePath);
  const project = projects.find((candidate) => candidate.normalizedRepoPath === workspacePath);
  const hasMeaningfulThreadLabel = isMeaningfulThreadLabel(conversation);
  const threadLabel = hasMeaningfulThreadLabel
    ? conversation.threadTitle!.trim()
    : conversation.conversationId.slice(0, 8);
  const title = project?.name || folderName || `Thread ${conversation.conversationId.slice(0, 8)}`;

  return {
    conversationId: conversation.conversationId,
    shortId: conversation.conversationId.slice(0, 8),
    title,
    threadLabel,
    hasMeaningfulThreadLabel,
    projectName: project?.name,
    folderName,
    workspacePath,
    threadLine: hasMeaningfulThreadLabel ? `Thread: ${threadLabel}` : `Thread ID: ${threadLabel}`,
    workspaceLine:
      project && folderName && normalizeLookupValue(project.name) !== normalizeLookupValue(folderName)
        ? `Carpeta: ${folderName}`
        : !project && !folderName && workspacePath
          ? `Ruta: ${shorten(workspacePath, 72)}`
          : undefined,
    summaryLineRaw: buildSummaryText(conversation),
    statusLabel: statusLabel(conversation),
    isActive: conversation.isActive,
    awaitingApproval: conversation.awaitingApproval,
    hasWorkingSource: conversation.isActive || isWorkingStatusLabel(statusLabel(conversation)),
    hasInactiveSource: !conversation.isActive,
    hasPendingSource: conversation.awaitingApproval,
    hiddenDuplicateCount: 0,
    sourceConversationIds: [conversation.conversationId],
    sourceShortIds: [conversation.conversationId.slice(0, 8)],
    lastTurnStartedAt: conversation.lastTurnStartedAt,
    lastTurnCompletedAt: conversation.lastTurnCompletedAt,
    lastContinueSentAt: conversation.lastContinueSentAt,
    lastContinueMode: conversation.lastContinueMode,
  };
};

const collapseConversationGroup = (group: ConversationSeed[]): ConversationSeed[] => {
  if (group.length <= 1) {
    return group;
  }

  if (group.some((conversation) => conversation.hasMeaningfulThreadLabel)) {
    return group;
  }

  const representative = chooseRepresentative(group);
  return [
    {
      ...representative,
      awaitingApproval: group.some((conversation) => conversation.awaitingApproval),
      isActive: group.some((conversation) => conversation.isActive),
      hasWorkingSource: group.some((conversation) => conversation.hasWorkingSource),
      hasInactiveSource: group.some((conversation) => conversation.hasInactiveSource),
      hasPendingSource: group.some((conversation) => conversation.hasPendingSource),
      hiddenDuplicateCount: group.length - 1,
      sourceConversationIds: group.map((conversation) => conversation.conversationId),
      sourceShortIds: group.map((conversation) => conversation.shortId),
      summaryLineRaw:
        representative.summaryLineRaw ??
        `Se detectaron ${group.length} registros del mismo repo; se muestra el mas util.`,
    },
  ];
};

const buildConversationLookup = (
  status: DesktopStatus,
  meta: DesktopConnectorMeta,
): DesktopConversationView[] => {
  const projects = meta.projects.map((project) => ({
    ...project,
    normalizedRepoPath: normalizeWorkspacePath(project.repoPath),
  }));

  const rawConversations = status.conversations.map((conversation) =>
    createConversationSeed(conversation, projects),
  );

  const groupedConversations = new Map<string, ConversationSeed[]>();
  for (const conversation of rawConversations) {
    const key = buildConversationGroupKey(conversation);
    const group = groupedConversations.get(key);
    if (group) {
      group.push(conversation);
    } else {
      groupedConversations.set(key, [conversation]);
    }
  }

  const visibleSeeds = [...groupedConversations.values()]
    .flatMap((group) => collapseConversationGroup(group))
    .sort(compareDisplayPriority);

  const conversationViews = visibleSeeds.map((conversation, index) => ({
    ...conversation,
    index: index + 1,
    summaryLine: conversation.summaryLineRaw,
    commandText: `/desktop_continue ${conversation.shortId}`,
    inspectCommandText: `/desktop_inspect ${conversation.shortId}`,
  }));

  return conversationViews.map((conversation) => ({
    ...conversation,
    summaryLine: rewriteDesktopNote(conversation.summaryLine, conversationViews),
  }));
};

export const rewriteDesktopNote = (
  note: string | undefined,
  conversations: DesktopConversationView[],
): string | undefined => {
  if (!note) {
    return undefined;
  }

  let rewritten = note;
  for (const conversation of conversations) {
    const replacement = `#${conversation.index} ${conversation.title}`;
    for (const alias of conversation.sourceConversationIds) {
      rewritten = rewritten.split(alias).join(replacement);
    }
  }

  return rewritten;
};

export const buildDesktopStatusView = (
  status: DesktopStatus,
  meta: DesktopConnectorMeta,
  filter: DesktopStatusFilter = "priority",
): DesktopStatusView => {
  const allConversationViews = buildConversationLookup(status, meta);
  const activeConversation = allConversationViews.find((conversation) =>
    conversation.sourceConversationIds.includes(status.activeConversationId ?? ""),
  );
  const lastCompletedConversation = allConversationViews.find((conversation) =>
    conversation.sourceConversationIds.includes(status.lastCompletedConversationId ?? ""),
  );
  const conversationViews = filterDesktopConversationViews(allConversationViews, filter).map(
    (conversation, index) => ({
      ...conversation,
      index: index + 1,
    }),
  );

  return {
    machineLabel: meta.machineName || `Connector ${status.connectorId.slice(0, 8)}`,
    summaryLines: [
      `Companion: ${status.desktopAutomationReady ? "listo" : "no listo"}`,
      `Autopilot: ${status.autopilotEnabled ? "encendido" : "apagado"} | Auto-turnos: ${status.autoContinueCount}/${status.maxAutoTurns}`,
      `Vista: ${desktopStatusFilterLabel(filter)} | ${conversationViews.length}/${allConversationViews.length}`,
      activeConversation ? `Activa: #${activeConversation.index} ${activeConversation.title}` : null,
      lastCompletedConversation
        ? `Ultima completa: #${lastCompletedConversation.index} ${lastCompletedConversation.title}`
        : null,
    ].filter((line): line is string => Boolean(line)),
    conversationViews,
    note: rewriteDesktopNote(status.note, allConversationViews),
    filter,
    totalConversationCount: allConversationViews.length,
  };
};

const isWorkingConversation = (conversation: DesktopConversationView): boolean =>
  conversation.hasWorkingSource;

const filterDesktopConversationViews = (
  conversations: DesktopConversationView[],
  filter: DesktopStatusFilter,
): DesktopConversationView[] => {
  switch (filter) {
    case "all":
      return conversations;
    case "working":
      return conversations.filter((conversation) => isWorkingConversation(conversation));
    case "inactive":
      return conversations.filter((conversation) => conversation.hasInactiveSource);
    case "pending":
      return conversations.filter((conversation) => conversation.hasPendingSource);
    default:
      return conversations;
  }
};

const formatMetaLine = (label: string, value: string): string =>
  `<b>${escapeHtml(label)}:</b> ${escapeHtml(value)}`;

const formatSummaryLine = (line: string): string => {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex <= 0) {
    return escapeHtml(line);
  }

  return formatMetaLine(line.slice(0, separatorIndex), line.slice(separatorIndex + 1).trim());
};

const formatWorkspaceLine = (line: string): string => {
  if (line.startsWith("Carpeta: ")) {
    return formatMetaLine("Carpeta", line.slice("Carpeta: ".length));
  }

  if (line.startsWith("Ruta: ")) {
    return `<b>Ruta:</b> <code>${escapeHtml(line.slice("Ruta: ".length))}</code>`;
  }

  return escapeHtml(line);
};

const formatConversationHeader = (conversation: DesktopConversationView): string => {
  const flags = [
    conversation.awaitingApproval ? "requiere accion" : null,
    conversation.isActive ? "activa" : null,
    !conversation.awaitingApproval && !conversation.isActive ? conversation.statusLabel : null,
  ].filter((value): value is string => Boolean(value));

  return flags.length
    ? `<b>#${conversation.index} ${escapeHtml(conversation.title)}</b> <i>${escapeHtml(flags.join(" | "))}</i>`
    : `<b>#${conversation.index} ${escapeHtml(conversation.title)}</b>`;
};

const formatConversationBlock = (conversation: DesktopConversationView): string =>
  [
    formatConversationHeader(conversation),
    conversation.hasMeaningfulThreadLabel
      ? formatMetaLine("Thread", conversation.threadLabel)
      : null,
    formatMetaLine("Estado", conversation.statusLabel),
    conversation.summaryLine ? formatMetaLine("Ultimo estado", conversation.summaryLine) : null,
    conversation.workspaceLine ? formatWorkspaceLine(conversation.workspaceLine) : null,
    conversation.workspacePath ? `<b>Ruta:</b> <code>${escapeHtml(conversation.workspacePath)}</code>` : null,
    `<b>Acciones:</b> <code>${escapeHtml(conversation.commandText)}</code> | <code>${escapeHtml(conversation.inspectCommandText)}</code>`,
    conversation.hiddenDuplicateCount > 0
      ? `<i>Se ocultaron ${conversation.hiddenDuplicateCount} registros historicos del mismo repo.</i>`
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

export const formatDesktopStatusText = (view: DesktopStatusView): string => {
  const visibleLimit = view.filter === "all" ? 12 : 8;
  const visibleConversations = view.conversationViews.slice(0, visibleLimit);
  const conversationBlocks = visibleConversations.map((conversation) =>
    formatConversationBlock(conversation),
  );
  const hiddenConversationCount = Math.max(0, view.conversationViews.length - visibleConversations.length);
  const outsideFilterCount = Math.max(0, view.totalConversationCount - view.conversationViews.length);

  return [
    `<b>Codex Desktop</b> | <b>${escapeHtml(view.machineLabel)}</b>`,
    ...view.summaryLines.map((line) => formatSummaryLine(line)),
    view.note ? formatMetaLine("Nota", view.note) : null,
    conversationBlocks.length ? "" : `<i>No hay conversaciones en esta vista.</i>`,
    ...conversationBlocks.flatMap((block, index) => (index === 0 ? [block] : ["", block])),
    outsideFilterCount > 0
      ? `\n<i>Hay ${outsideFilterCount} conversaciones fuera del filtro actual.</i>`
      : null,
    hiddenConversationCount > 0
      ? `\n<i>Hay ${hiddenConversationCount} conversaciones adicionales en esta vista.</i>`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
};

export const formatDesktopConversationInspectText = (
  machineLabel: string,
  conversation: DesktopConversationView,
): string =>
  [
    `<b>Codex Desktop</b> | <b>${escapeHtml(machineLabel)}</b>`,
    `<b>Thread #${conversation.index}</b> ${escapeHtml(conversation.title)}`,
    conversation.hasMeaningfulThreadLabel
      ? formatMetaLine("Thread", conversation.threadLabel)
      : formatMetaLine("Thread ID", conversation.shortId),
    formatMetaLine("Estado", conversation.statusLabel),
    conversation.summaryLine ? formatMetaLine("Ultimo estado", conversation.summaryLine) : null,
    conversation.workspaceLine ? formatWorkspaceLine(conversation.workspaceLine) : null,
    conversation.workspacePath ? `<b>Ruta:</b> <code>${escapeHtml(conversation.workspacePath)}</code>` : null,
    conversation.lastTurnStartedAt
      ? formatMetaLine("Ultimo turn iniciado", formatDesktopTimestamp(conversation.lastTurnStartedAt)!)
      : null,
    conversation.lastTurnCompletedAt
      ? formatMetaLine("Ultimo turn completo", formatDesktopTimestamp(conversation.lastTurnCompletedAt)!)
      : null,
    conversation.lastContinueSentAt
      ? formatMetaLine(
          "Ultimo continue",
          `${formatDesktopTimestamp(conversation.lastContinueSentAt)!}${conversation.lastContinueMode ? ` (${conversation.lastContinueMode})` : ""}`,
        )
      : null,
    conversation.hiddenDuplicateCount > 0
      ? formatMetaLine(
          "Historial oculto",
          `${conversation.hiddenDuplicateCount} registros del mismo repo se unificaron en esta vista`,
        )
      : null,
    `<b>Acciones:</b> <code>${escapeHtml(conversation.commandText)}</code> | <code>${escapeHtml(conversation.inspectCommandText)}</code>`,
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

  const exactIdMatch = conversationViews.find((conversation) =>
    conversation.sourceConversationIds.includes(normalizedReference),
  );
  if (exactIdMatch) {
    return exactIdMatch;
  }

  const prefixMatches = conversationViews.filter((conversation) =>
    conversation.sourceConversationIds.some((alias) => alias.startsWith(normalizedReference)),
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
      ...conversation.sourceShortIds,
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
      ...conversation.sourceShortIds,
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
