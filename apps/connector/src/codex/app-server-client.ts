import { EventEmitter } from "node:events";
import type {
  ApprovalDecision,
  ApprovalRequest,
  SessionEvent,
  SessionResumePayload,
  SessionSnapshot,
  SessionStatus,
  TaskCreate,
} from "@codex-relay/contracts";
import { SAFE_CONTINUE_PROMPT } from "@codex-relay/contracts";

import { JsonRpcProcess } from "./json-rpc-process.js";

type SessionState = {
  sessionId: string;
  repoPath: string;
  projectId: string;
  prompt: string;
  threadId?: string;
  paused: boolean;
  continuePrompt: string;
  status: SessionStatus;
};

type AppServerClientOptions = {
  commandLine: string;
};

const asText = (value: unknown, fallback: string): string => {
  return typeof value === "string" && value.trim() ? value : fallback;
};

export class AppServerClient extends EventEmitter {
  private readonly rpc: JsonRpcProcess;
  private initialized = false;
  private readonly sessions = new Map<string, SessionState>();
  private readonly threads = new Map<string, string>();

  constructor(options: AppServerClientOptions) {
    super();
    this.rpc = new JsonRpcProcess(options.commandLine);
    this.rpc.on("notification", (method, params) => {
      void this.handleNotification(method, params as Record<string, unknown>);
    });
    this.rpc.on("stderr", (line) => {
      this.emit("session.event", {
        sessionId: "system",
        type: "connector.stderr",
        severity: "warning",
        timestamp: new Date().toISOString(),
        summary: String(line).trim(),
      } satisfies SessionEvent);
    });
  }

  static detect(commandLine: string) {
    return JsonRpcProcess.detectVersion(commandLine);
  }

  async startTask(sessionId: string, task: TaskCreate): Promise<void> {
    await this.ensureInitialized();

    const threadId =
      task.threadId ||
      asText(
        (await this.rpc.request("thread/start", {
          cwd: task.repoPath,
        })) as { threadId?: string },
        sessionId,
      );

    const state: SessionState = {
      sessionId,
      repoPath: task.repoPath,
      projectId: task.projectId,
      prompt: task.prompt,
      threadId,
      paused: false,
      continuePrompt: task.autoContinuePolicy.continuePrompt || SAFE_CONTINUE_PROMPT,
      status: "running",
    };

    this.sessions.set(sessionId, state);
    this.threads.set(threadId, sessionId);

    await this.rpc.request("turn/start", {
      threadId,
      input: task.prompt,
      cwd: task.repoPath,
    });

    this.emitSnapshot(state, "running", "Task started");
  }

  async continueSession(sessionId: string): Promise<void> {
    const state = this.requireSession(sessionId);
    await this.rpc.request("turn/start", {
      threadId: state.threadId,
      input: state.continuePrompt,
      cwd: state.repoPath,
    });
    state.paused = false;
    state.status = "running";
    this.emitSnapshot(state, "running", "Continue dispatched");
  }

  async resolveApproval(
    sessionId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    const state = this.requireSession(sessionId);
    await this.rpc.request("approval/resolve", {
      threadId: state.threadId,
      approvalId,
      decision,
    });
    this.emit("session.event", {
      sessionId,
      type: "approval.resolved",
      severity: "info",
      timestamp: new Date().toISOString(),
      summary: `Approval ${approvalId} resolved with ${decision}`,
    } satisfies SessionEvent);
  }

  async abortSession(sessionId: string): Promise<void> {
    const state = this.requireSession(sessionId);
    await this.rpc.request("thread/abort", {
      threadId: state.threadId,
    });
    state.status = "aborted";
    this.emitSnapshot(state, "aborted", "Session aborted");
  }

  pauseSession(sessionId: string): void {
    const state = this.requireSession(sessionId);
    state.paused = true;
    state.status = "paused";
    this.emitSnapshot(state, "paused", "Session paused locally");
  }

  restoreSession(sessionId: string, payload: SessionResumePayload): void {
    const existing = this.sessions.get(sessionId);
    if (existing?.threadId && existing.threadId !== payload.threadId) {
      this.threads.delete(existing.threadId);
    }

    const state: SessionState = {
      sessionId,
      repoPath: payload.repoPath,
      projectId: payload.projectId,
      prompt: payload.prompt,
      threadId: payload.threadId,
      paused: payload.status === "paused",
      continuePrompt: payload.continuePrompt,
      status: payload.status,
      ...(existing ?? {}),
    };

    state.repoPath = payload.repoPath;
    state.projectId = payload.projectId;
    state.prompt = payload.prompt;
    state.threadId = payload.threadId;
    state.paused = payload.status === "paused";
    state.continuePrompt = payload.continuePrompt;
    state.status = payload.status;

    this.sessions.set(sessionId, state);
    this.threads.set(payload.threadId, sessionId);
    this.emitSnapshot(state, payload.status, "Session restored after reconnect");
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.rpc.start();
    await this.rpc.request("initialize", {
      clientInfo: {
        name: "codex-relay-connector",
        version: "0.1.0",
      },
    });
    this.initialized = true;
  }

  private requireSession(sessionId: string): SessionState {
    const state = this.sessions.get(sessionId);
    if (!state || !state.threadId) {
      throw new Error(`Unknown session ${sessionId}`);
    }

    return state;
  }

  private async handleNotification(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
    const sessionId =
      (typeof params.sessionId === "string" ? params.sessionId : undefined) ||
      (threadId ? this.threads.get(threadId) : undefined);

    if (!sessionId) {
      return;
    }

    const state = this.sessions.get(sessionId);
    if (threadId && state) {
      state.threadId = threadId;
      this.threads.set(threadId, sessionId);
    }

    if (method.includes("approval")) {
      if (state) {
        state.status = "waiting_for_approval";
      }
      const approval: ApprovalRequest = {
        approvalId: asText(params.approvalId, crypto.randomUUID()),
        sessionId,
        kind: "commandExecution",
        message: asText(params.message, method),
        options: ["accept", "decline", "cancel"],
        expiresAt:
          typeof params.expiresAt === "string" ? params.expiresAt : undefined,
      };
      this.emit("approval.requested", approval);
      return;
    }

    const severity =
      method.includes("failed") || method.includes("error")
        ? "error"
        : method.includes("warning")
          ? "warning"
          : "info";
    const summary = asText(
      params.summary ?? params.message,
      method,
    );

    this.emit("session.event", {
      sessionId,
      type: method.includes("completed") ? "turn.completed" : method,
      severity,
      timestamp: new Date().toISOString(),
      summary,
      rawRef: threadId,
    } satisfies SessionEvent);

    if (state) {
      const status =
        method.includes("completed")
          ? "running"
          : method.includes("failed")
            ? "failed"
            : state.paused
              ? "paused"
              : "running";
      state.status = status;
      this.emitSnapshot(state, status, summary);
    }
  }

  private emitSnapshot(
    state: SessionState,
    status: SessionSnapshot["status"],
    latestSummary: string,
  ): void {
    this.emit("session.snapshot", {
      id: state.sessionId,
      connectorId: "",
      projectId: state.projectId,
      threadId: state.threadId,
      prompt: state.prompt,
      status,
      autoContinueTurns: 0,
      autoContinuePolicy: {
        mode: "safe",
        maxAutoTurns: 5,
        continuePrompt: state.continuePrompt,
      },
      latestSummary,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies SessionSnapshot);
  }
}
