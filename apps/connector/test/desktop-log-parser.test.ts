import { describe, expect, it } from "vitest";

import { parseDesktopLogLine } from "../src/desktop/log-parser.js";

describe("parseDesktopLogLine", () => {
  it("extracts turn start lines", () => {
    expect(
      parseDesktopLogLine(
        "[electron-message-handler] method=turn/start originWebcontentsId=1 conversationId=conversation-1"
      ),
    ).toEqual({
      kind: "turn.start",
      conversationId: "conversation-1",
    });
  });

  it("extracts turn complete lines", () => {
    expect(
      parseDesktopLogLine(
        "[electron-message-handler] [desktop-notifications] show turn-complete conversationId=conversation-1"
      ),
    ).toEqual({
      kind: "turn.complete",
      conversationId: "conversation-1",
    });
  });
});
