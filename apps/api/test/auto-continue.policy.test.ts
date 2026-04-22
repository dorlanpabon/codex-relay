import { describe, expect, it } from "vitest";

import { defaultAutoContinuePolicy } from "@codex-relay/contracts";

import { AutoContinuePolicyService } from "../src/modules/sessions/auto-continue.policy.js";

describe("AutoContinuePolicyService", () => {
  const service = new AutoContinuePolicyService();

  it("continues when a turn completes without blockers", () => {
    const result = service.evaluate({
      policy: defaultAutoContinuePolicy(),
      autoContinueTurns: 0,
      pendingApprovals: 0,
      latestEvent: {
        sessionId: "session-1",
        type: "turn.completed",
        severity: "info",
        timestamp: new Date().toISOString(),
        summary: "Turn completed successfully"
      },
      recentEvents: []
    });

    expect(result.shouldContinue).toBe(true);
  });

  it("stops on explicit questions", () => {
    const result = service.evaluate({
      policy: defaultAutoContinuePolicy(),
      autoContinueTurns: 0,
      pendingApprovals: 0,
      latestEvent: {
        sessionId: "session-1",
        type: "turn.completed",
        severity: "info",
        timestamp: new Date().toISOString(),
        summary: "Need user decision?"
      },
      recentEvents: []
    });

    expect(result.shouldContinue).toBe(false);
    expect(result.reason).toBe("explicit_user_question");
  });
});
