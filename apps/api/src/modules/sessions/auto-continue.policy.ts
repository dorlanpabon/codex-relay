import { Injectable } from "@nestjs/common";

import type { AutoContinuePolicy, SessionEvent } from "@codex-relay/contracts";

type AutomationDecision = {
  shouldContinue: boolean;
  reason: string;
};

const QUESTION_REGEX = /\?|\b(decision|clarifi|approval|permiso|credenciales)\b/i;

@Injectable()
export class AutoContinuePolicyService {
  evaluate(params: {
    policy: AutoContinuePolicy;
    autoContinueTurns: number;
    pendingApprovals: number;
    latestEvent: SessionEvent;
    recentEvents: Array<Pick<SessionEvent, "severity" | "summary" | "type">>;
  }): AutomationDecision {
    const { policy, autoContinueTurns, pendingApprovals, latestEvent, recentEvents } = params;

    if (policy.mode === "manual") {
      return { shouldContinue: false, reason: "manual_mode" };
    }

    if (pendingApprovals > 0) {
      return { shouldContinue: false, reason: "pending_approval" };
    }

    if (autoContinueTurns >= policy.maxAutoTurns) {
      return { shouldContinue: false, reason: "limit_reached" };
    }

    if (latestEvent.type !== "turn.completed") {
      return { shouldContinue: false, reason: "turn_not_completed" };
    }

    if (QUESTION_REGEX.test(latestEvent.summary)) {
      return { shouldContinue: false, reason: "explicit_user_question" };
    }

    const recentErrors = recentEvents.filter((event) => event.severity !== "info");
    if (recentErrors.length >= 2) {
      return { shouldContinue: false, reason: "repeated_error_or_warning" };
    }

    return { shouldContinue: true, reason: "safe_auto_continue" };
  }
}

