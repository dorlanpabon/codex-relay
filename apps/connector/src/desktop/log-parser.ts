export type DesktopLogSignal =
  | {
      kind: "turn.start";
      conversationId: string;
      workspacePath?: string;
      occurredAt?: string;
    }
  | {
      kind: "turn.complete";
      conversationId: string;
      workspacePath?: string;
      occurredAt?: string;
    }
  | {
      kind: "workspace.hint";
      workspacePath: string;
      occurredAt?: string;
    };

const extractTimestamp = (line: string): string | undefined => {
  const match = line.match(
    /^(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\b/,
  );
  return match?.groups?.timestamp;
};

const extractConversationId = (line: string): string | null => {
  const match = line.match(/\bconversationId=([^\s]+)/);
  return match?.[1] ?? null;
};

const normalizeWorkspacePath = (value: string): string => {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.endsWith("/.git") ? normalized.slice(0, -5) : normalized;
};

const extractWorkspacePath = (line: string): string | null => {
  const match = line.match(/\bcwd=([^\s]+)/);
  if (!match?.[1]) {
    return null;
  }

  return normalizeWorkspacePath(match[1]);
};

export const parseDesktopLogLine = (line: string): DesktopLogSignal | null => {
  const conversationId = extractConversationId(line);
  const workspacePath = extractWorkspacePath(line);
  const occurredAt = extractTimestamp(line);

  if (conversationId && line.includes("method=turn/start")) {
    return {
      kind: "turn.start",
      conversationId,
      ...(workspacePath ? { workspacePath } : {}),
      ...(occurredAt ? { occurredAt } : {}),
    };
  }

  if (conversationId && line.includes("[desktop-notifications] show turn-complete")) {
    return {
      kind: "turn.complete",
      conversationId,
      ...(workspacePath ? { workspacePath } : {}),
      ...(occurredAt ? { occurredAt } : {}),
    };
  }

  if (workspacePath) {
    return {
      kind: "workspace.hint",
      workspacePath,
      ...(occurredAt ? { occurredAt } : {}),
    };
  }

  return null;
};
