import { describe, expect, it, vi } from "vitest";

import type { DesktopStatus } from "@codex-relay/contracts";

import { ConnectorHubService } from "../src/modules/connectors/connector-hub.service.js";

const createService = () => {
  const queue = {
    enqueueTelegramNotification: vi.fn().mockResolvedValue(undefined),
  };
  const service = new ConnectorHubService(
    {
      validatePairing: vi.fn(),
      applyHello: vi.fn(),
    } as never,
    {
      handleConnectorEnvelope: vi.fn(),
      listRecoverableSessions: vi.fn().mockResolvedValue([]),
    } as never,
    {
      createSystemContinue: vi.fn(),
      createUserCommand: vi.fn(),
      toEnvelope: vi.fn(),
      markSent: vi.fn(),
      markFailed: vi.fn(),
      listQueuedCommands: vi.fn().mockResolvedValue([]),
    } as never,
    queue as never,
    {
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as never,
  );

  return { queue, service };
};

const baseStatus = (): DesktopStatus => ({
  connectorId: "connector-1",
  connected: true,
  desktopAutomationReady: true,
  autopilotEnabled: false,
  maxAutoTurns: 5,
  autoContinueCount: 0,
  conversations: [],
});

describe("ConnectorHubService desktop notifications", () => {
  it("queues approval notifications per conversation", async () => {
    const { queue, service } = createService();

    await service["handleDesktopStatus"]("user-1", "connector-1", baseStatus());
    await service["handleDesktopStatus"]("user-1", "connector-1", {
      ...baseStatus(),
      conversations: [
        {
          conversationId: "conversation-1",
          status: "waiting_manual",
          isActive: true,
          awaitingApproval: true,
          autoContinueCount: 0,
          lastTurnCompletedAt: "2026-04-22T12:00:00.000Z",
          note: "Esperando aprobacion remota.",
        },
      ],
      activeConversationId: "conversation-1",
      lastCompletedConversationId: "conversation-1",
      lastTurnCompletedAt: "2026-04-22T12:00:00.000Z",
    });

    expect(queue.enqueueTelegramNotification).toHaveBeenCalledWith(
      "desktop-awaiting-approval",
      expect.objectContaining({
        connectorId: "connector-1",
        conversationId: "conversation-1",
      }),
    );
  });

  it("queues autopilot notifications only when a new continue was sent", async () => {
    const { queue, service } = createService();

    await service["handleDesktopStatus"]("user-1", "connector-1", baseStatus());
    await service["handleDesktopStatus"]("user-1", "connector-1", {
      ...baseStatus(),
      autopilotEnabled: true,
      autoContinueCount: 1,
      conversations: [
        {
          conversationId: "conversation-1",
          status: "auto_continue_sent",
          isActive: true,
          awaitingApproval: false,
          autoContinueCount: 1,
          lastTurnCompletedAt: "2026-04-22T12:00:00.000Z",
          lastContinueSentAt: "2026-04-22T12:00:01.000Z",
          lastContinueMode: "autopilot",
          note: "Autopilot envio continue.",
        },
      ],
      activeConversationId: "conversation-1",
      lastCompletedConversationId: "conversation-1",
      lastTurnCompletedAt: "2026-04-22T12:00:00.000Z",
    });
    await service["handleDesktopStatus"]("user-1", "connector-1", {
      ...baseStatus(),
      autopilotEnabled: true,
      autoContinueCount: 1,
      conversations: [
        {
          conversationId: "conversation-1",
          status: "auto_continue_sent",
          isActive: true,
          awaitingApproval: false,
          autoContinueCount: 1,
          lastTurnCompletedAt: "2026-04-22T12:00:00.000Z",
          lastContinueSentAt: "2026-04-22T12:00:01.000Z",
          lastContinueMode: "autopilot",
          note: "Autopilot envio continue.",
        },
      ],
      activeConversationId: "conversation-1",
      lastCompletedConversationId: "conversation-1",
      lastTurnCompletedAt: "2026-04-22T12:00:00.000Z",
    });

    expect(queue.enqueueTelegramNotification).toHaveBeenCalledTimes(1);
    expect(queue.enqueueTelegramNotification).toHaveBeenCalledWith(
      "desktop-continue-sent",
      expect.objectContaining({
        connectorId: "connector-1",
        conversationId: "conversation-1",
      }),
    );
  });
});
