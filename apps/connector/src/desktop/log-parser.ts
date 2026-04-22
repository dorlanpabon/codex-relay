export type DesktopLogSignal =
  | {
      kind: "turn.start";
      conversationId: string;
      workspacePath?: string;
    }
  | {
      kind: "turn.complete";
      conversationId: string;
      workspacePath?: string;
    }
  | {
      kind: "workspace.hint";
      workspacePath: string;
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

  if (conversationId && line.includes("method=turn/start")) {
    return {
      kind: "turn.start",
      conversationId,
      ...(workspacePath ? { workspacePath } : {}),
    };
  }

  if (conversationId && line.includes("[desktop-notifications] show turn-complete")) {
    return {
      kind: "turn.complete",
      conversationId,
      ...(workspacePath ? { workspacePath } : {}),
    };
  }

  if (workspacePath) {
    return {
      kind: "workspace.hint",
      workspacePath,
    };
  }

  return null;
};
