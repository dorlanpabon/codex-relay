const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const userId = process.env.NEXT_PUBLIC_USER_ID ?? "local-dev-user";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${path}`);
  }

  return response.json() as Promise<T>;
}

export type ConnectorDto = {
  id: string;
  machineName: string;
  platform: string;
  codexVersion?: string | null;
  appServerReady: boolean;
  desktopAutomationReady?: boolean;
  status: string;
  projects: Array<{
    id: string;
    name: string;
    repoPath: string;
  }>;
};

export type SessionDto = {
  id: string;
  status: string;
  latestSummary?: string | null;
  autoContinueTurns: number;
  autoContinueMaxTurns: number;
  updatedAt: string;
  connector: {
    machineName: string;
  };
  project: {
    name: string;
  };
};

export type SessionDetailDto = {
  id: string;
  status: string;
  prompt: string;
  threadId?: string | null;
  latestSummary?: string | null;
  autoContinueTurns: number;
  autoContinueMaxTurns: number;
  connector: {
    machineName: string;
    platform: string;
  };
  project: {
    name: string;
    repoPath: string;
  };
  events: Array<{
    id: string;
    type: string;
    severity: string;
    summary: string;
    createdAt: string;
  }>;
  approvals: Array<{
    id: string;
    kind: string;
    message: string;
    status: string;
    options: string[];
  }>;
};

export type HealthDto = {
  status: "ok" | "degraded";
  timestamp: string;
  services: {
    api: "ok";
    database: "ok" | "error";
    redis: "ok" | "disabled" | "error";
    telegram: "configured" | "disabled";
  };
  stats: {
    connectors: number;
    sessions: number;
  };
};

export type DesktopStatusDto = {
  connectorId: string;
  connected: boolean;
  desktopAutomationReady: boolean;
  autopilotEnabled: boolean;
  maxAutoTurns: number;
  autoContinueCount: number;
  conversations: Array<{
    conversationId: string;
    status: string;
    isActive: boolean;
    awaitingApproval: boolean;
    autoContinueCount: number;
    lastTurnStartedAt?: string;
    lastTurnCompletedAt?: string;
    lastContinueSentAt?: string;
    lastContinueMode?: "manual" | "autopilot";
    note?: string;
  }>;
  activeConversationId?: string;
  lastCompletedConversationId?: string;
  lastTurnCompletedAt?: string;
  note?: string;
};

export const getConnectors = () => apiFetch<ConnectorDto[]>("/connectors");
export const getSessions = () => apiFetch<SessionDto[]>("/sessions");
export const getSession = (id: string) => apiFetch<SessionDetailDto>(`/sessions/${id}`);
export const getHealth = () => apiFetch<HealthDto>("/health");
export const getDesktopStatus = () =>
  apiFetch<DesktopStatusDto | null>("/connectors/desktop/status");

export const createTask = (payload: {
  projectId: string;
  repoPath: string;
  prompt: string;
}) =>
  apiFetch<{ id: string }>("/tasks", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      threadMode: "new",
      autoContinuePolicy: {
        mode: "safe",
        maxAutoTurns: 5,
        continuePrompt:
          "Continua hasta terminar. Solo detente si necesitas una decision real, credenciales externas, o una aclaracion imposible de inferir.",
      },
    }),
  });

export const sendCommand = (payload: {
  sessionId: string;
  command: "continue" | "approve_once" | "pause" | "abort" | "resume_thread";
  approvalId?: string;
  decision?: string;
  threadId?: string;
}) =>
  apiFetch("/commands", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const sendDesktopCommand = (payload: {
  connectorId?: string;
  command:
    | "continue_active"
    | "continue_conversation"
    | "autopilot_on"
    | "autopilot_off";
  conversationId?: string;
  maxAutoTurns?: number;
}) =>
  apiFetch("/connectors/desktop/commands", {
    method: "POST",
    body: JSON.stringify(payload),
  });
