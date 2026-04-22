import { describe, expect, it } from "vitest";

import {
  ConnectorCommandEnvelopeSchema,
  ConnectorEventEnvelopeSchema,
  TaskCreateSchema,
  defaultAutoContinuePolicy,
} from "../src/index.js";

describe("contracts", () => {
  it("applies safe defaults to task creation", () => {
    const parsed = TaskCreateSchema.parse({
      projectId: "project-1",
      prompt: "Implementa la tarea",
      repoPath: "D:\\repo",
    });

    expect(parsed.threadMode).toBe("new");
    expect(parsed.autoContinuePolicy.maxAutoTurns).toBe(5);
  });

  it("accepts connector command envelopes", () => {
    const envelope = ConnectorCommandEnvelopeSchema.parse({
      type: "session.command",
      sessionId: "session-1",
      payload: {
        sessionId: "session-1",
        command: "continue",
      },
    });

    expect(envelope.type).toBe("session.command");
  });

  it("accepts session resume envelopes with recovery context", () => {
    const envelope = ConnectorCommandEnvelopeSchema.parse({
      type: "session.resume",
      sessionId: "session-1",
      payload: {
        threadId: "thread-1",
        projectId: "project-1",
        repoPath: "D:\\repo",
        prompt: "Implementa la tarea",
        continuePrompt: "Continua hasta terminar.",
        status: "paused",
      },
    });

    expect(envelope.type).toBe("session.resume");
    expect(envelope.payload.repoPath).toBe("D:\\repo");
  });

  it("accepts desktop control envelopes and status events", () => {
    const command = ConnectorCommandEnvelopeSchema.parse({
      type: "desktop.command",
      payload: {
        connectorId: "connector-1",
        command: "autopilot_on",
        maxAutoTurns: 8,
      },
    });
    const status = ConnectorEventEnvelopeSchema.parse({
      type: "desktop.status",
      payload: {
        connectorId: "connector-1",
        connected: true,
        desktopAutomationReady: true,
        autopilotEnabled: true,
        maxAutoTurns: 8,
        autoContinueCount: 2,
        activeConversationId: "conversation-1",
        lastTurnCompletedAt: new Date().toISOString(),
        note: "Autopilot activo",
      },
    });

    expect(command.type).toBe("desktop.command");
    expect(status.type).toBe("desktop.status");
  });

  it("accepts connector event envelopes", () => {
    const policy = defaultAutoContinuePolicy();
    const envelope = ConnectorEventEnvelopeSchema.parse({
      type: "session.snapshot",
      payload: {
        id: "session-1",
        connectorId: "connector-1",
        projectId: "project-1",
        prompt: "Hola",
        status: "running",
        autoContinueTurns: 1,
        autoContinuePolicy: policy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    expect(envelope.type).toBe("session.snapshot");
  });
});
