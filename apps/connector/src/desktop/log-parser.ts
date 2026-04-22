export type DesktopLogSignal =
  | {
      kind: "turn.start";
      conversationId: string;
    }
  | {
      kind: "turn.complete";
      conversationId: string;
    };

const extractConversationId = (line: string): string | null => {
  const match = line.match(/\bconversationId=([^\s]+)/);
  return match?.[1] ?? null;
};

export const parseDesktopLogLine = (line: string): DesktopLogSignal | null => {
  const conversationId = extractConversationId(line);
  if (!conversationId) {
    return null;
  }

  if (line.includes("method=turn/start")) {
    return {
      kind: "turn.start",
      conversationId,
    };
  }

  if (line.includes("[desktop-notifications] show turn-complete")) {
    return {
      kind: "turn.complete",
      conversationId,
    };
  }

  return null;
};
