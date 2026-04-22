import { describe, expect, it } from "vitest";

import { buildDesktopKeyboard, parseCallbackData } from "../src/index.js";

describe("@codex-relay/telegram", () => {
  it("builds desktop keyboard with continue and inspect buttons per conversation", () => {
    const keyboard = buildDesktopKeyboard(
      {
        connectorId: "connector-1",
        autopilotEnabled: false,
      },
      {
        primaryConversationId: "conversation-1",
        primaryContinueLabel: "Continuar #1",
        conversations: [
          {
            conversationId: "conversation-1",
            continueLabel: "#1 Continuar",
            inspectLabel: "#1 Ver detalle",
          },
        ],
      },
    );

    expect(keyboard.inline_keyboard[0]?.[0]?.callback_data).toBe("deskc:conversation-1");
    expect(keyboard.inline_keyboard[0]?.[1]?.callback_data).toBe("deskstatus:connector-1");
    expect(keyboard.inline_keyboard[2]?.[0]?.text).toBe("#1 Continuar");
    expect(keyboard.inline_keyboard[2]?.[1]?.callback_data).toBe("deski:conversation-1");
    expect(keyboard.inline_keyboard[0]?.[0]?.callback_data.length).toBeLessThanOrEqual(64);
  });

  it("parses desktop callbacks with conversationId", () => {
    expect(parseCallbackData("deskc:conversation-1")).toEqual({
      kind: "desktop.command",
      command: "continue_conversation",
      conversationId: "conversation-1",
    });
  });

  it("parses desktop refresh callbacks", () => {
    expect(parseCallbackData("deskstatus:connector-1")).toEqual({
      kind: "desktop.refresh",
      connectorId: "connector-1",
    });
  });

  it("parses desktop inspect callbacks", () => {
    expect(parseCallbackData("deski:conversation-1")).toEqual({
      kind: "desktop.inspect",
      conversationId: "conversation-1",
    });
  });
});
