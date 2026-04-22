import { describe, expect, it } from "vitest";

import { buildDesktopKeyboard, parseCallbackData } from "../src/index.js";

describe("@codex-relay/telegram", () => {
  it("builds desktop keyboard with refresh and named conversation buttons", () => {
    const keyboard = buildDesktopKeyboard(
      {
        connectorId: "connector-1",
        autopilotEnabled: false,
      },
      {
        primaryConversationId: "conversation-1",
        primaryContinueLabel: "Continuar #1",
        conversations: [{ conversationId: "conversation-1", label: "#1 orders_codex" }],
      },
    );

    expect(keyboard.inline_keyboard[0]?.[0]?.callback_data).toBe("deskc:conversation-1");
    expect(keyboard.inline_keyboard[0]?.[1]?.callback_data).toBe("deskstatus:connector-1");
    expect(keyboard.inline_keyboard[2]?.[0]?.text).toBe("#1 orders_codex");
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
});
