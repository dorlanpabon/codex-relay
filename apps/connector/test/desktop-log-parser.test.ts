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

  it("extracts workspace hints and normalizes .git suffixes", () => {
    expect(
      parseDesktopLogLine(
        '2026-04-21T05:55:43.278Z warning [git] git.command.complete cwd=D:\\Usuario\\Descargas\\dropshipping_local\\.git durationMs=168'
      ),
    ).toEqual({
      kind: "workspace.hint",
      workspacePath: "D:/Usuario/Descargas/dropshipping_local",
    });
  });
});
