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

    expect(keyboard.inline_keyboard[0]?.[0]?.callback_data).toBe(
      "deskcontinue:connector-1:conversation-1",
    );
  });

  it("parses desktop callbacks with conversationId", () => {
    expect(parseCallbackData("deskcontinue:connector-1:conversation-1")).toEqual({
      kind: "desktop.command",
      connectorId: "connector-1",
      command: "continue_conversation",
      conversationId: "conversation-1",
    });
  });
});
