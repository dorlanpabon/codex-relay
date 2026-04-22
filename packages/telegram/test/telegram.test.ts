import { describe, expect, it } from "vitest";

import {
  buildApprovalKeyboard,
  buildSessionKeyboard,
  parseCallbackData,
  parseRunCommand,
} from "../src/index.js";

describe("telegram helpers", () => {
  it("builds session controls", () => {
    const keyboard = buildSessionKeyboard("session-1");
    expect(keyboard.inline_keyboard[0]?.[0]?.callback_data).toBe("continue:session-1");
  });

  it("builds approval buttons", () => {
    const keyboard = buildApprovalKeyboard({
      approvalId: "approval-1",
      sessionId: "session-1",
      kind: "commandExecution",
      message: "Approve this",
      options: ["accept", "decline"],
    });

    expect(keyboard.inline_keyboard).toHaveLength(2);
  });

  it("parses /run commands", () => {
    expect(parseRunCommand("/run D:\\repo arregla el bug")?.repoPath).toBe("D:\\repo");
  });

  it("parses quoted /run commands", () => {
    expect(parseRunCommand('/run "D:\\mi repo" arregla el bug')?.repoPath).toBe(
      "D:\\mi repo",
    );
  });

  it("parses approval callbacks", () => {
    expect(parseCallbackData("approve:session-1:approval-1:accept")).toEqual({
      kind: "approval",
      sessionId: "session-1",
      approvalId: "approval-1",
      decision: "accept",
    });
  });
});
