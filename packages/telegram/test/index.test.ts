import { describe, expect, it } from "vitest";

import { buildDesktopKeyboard, parseCallbackData } from "../src/index.js";

describe("@codex-relay/telegram", () => {
  it("builds a conversation-scoped desktop continue button", () => {
    const keyboard = buildDesktopKeyboard(
      {
        connectorId: "connector-1",
        autopilotEnabled: false,
      },
      "conversation-1",
    );

    expect(keyboard.inline_keyboard[0]?.[0]?.callback_data).toBe("deskc:conversation-1");
    expect(keyboard.inline_keyboard[0]?.[0]?.callback_data.length).toBeLessThanOrEqual(64);
  });

  it("parses desktop callbacks with conversationId", () => {
    expect(parseCallbackData("deskc:conversation-1")).toEqual({
      kind: "desktop.command",
      command: "continue_conversation",
      conversationId: "conversation-1",
    });
  });
});
