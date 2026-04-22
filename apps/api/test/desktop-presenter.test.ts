import { describe, expect, it } from "vitest";

import {
  buildDesktopStatusView,
  formatDesktopConversationInspectText,
  formatDesktopStatusText,
  parseDesktopStatusFilter,
  resolveDesktopConversationReference,
} from "../src/modules/telegram/desktop-presenter.js";

describe("desktop-presenter", () => {
  const status = {
    connectorId: "connector-1",
    connected: true,
    desktopAutomationReady: true,
    autopilotEnabled: false,
    maxAutoTurns: 8,
    autoContinueCount: 0,
    activeConversationId: "conversation-1",
    lastCompletedConversationId: "conversation-2",
    note: "Turn detectado en conversation-2.",
    conversations: [
      {
        conversationId: "conversation-1",
        status: "running" as const,
        isActive: true,
        awaitingApproval: false,
        autoContinueCount: 0,
        workspacePath: "D:/xampp/htdocs/orders_codex",
        lastMessagePreview: "Estoy revisando el merge de main y ajustando apps.",
        lastTurnStartedAt: "2026-04-22T12:00:00.000Z",
      },
      {
        conversationId: "conversation-2",
        status: "waiting_manual" as const,
        isActive: false,
        awaitingApproval: true,
        autoContinueCount: 0,
        workspacePath: "D:/xampp/htdocs/orders_codex",
        note: "Turn completo en conversation-2. Esperando aprobacion remota.",
        lastTurnCompletedAt: "2026-04-22T11:58:00.000Z",
      },
      {
        conversationId: "conversation-3",
        status: "running" as const,
        isActive: false,
        awaitingApproval: false,
        autoContinueCount: 0,
        workspacePath: "D:/xampp/htdocs/agent_dropshipping",
        threadTitle: "Pulir onboarding",
        lastMessagePreview: "Estoy ordenando el flujo inicial y afinando textos.",
        lastTurnStartedAt: "2026-04-22T10:00:00.000Z",
      },
    ],
  };

  const meta = {
    machineName: "DESKTOP-DEV",
    projects: [
      { name: "orders_codex", repoPath: "D:/xampp/htdocs/orders_codex" },
      { name: "agent_dropshipping", repoPath: "D:/xampp/htdocs/agent_dropshipping" },
    ],
  };

  it("collapses duplicate repo conversations with synthetic thread ids", () => {
    const view = buildDesktopStatusView(status, meta);

    expect(view.conversationViews).toHaveLength(2);
    expect(view.conversationViews[0]?.title).toBe("orders_codex");
    expect(view.conversationViews[0]?.hiddenDuplicateCount).toBe(1);
    expect(view.conversationViews[0]?.sourceConversationIds).toEqual([
      "conversation-1",
      "conversation-2",
    ]);
    expect(view.note).toContain("#1 orders_codex");
  });

  it("formats desktop status as HTML with clearer structure", () => {
    const view = buildDesktopStatusView(status, meta);
    const text = formatDesktopStatusText(view);

    expect(text).toContain("<b>Codex Desktop</b> | <b>DESKTOP-DEV</b>");
    expect(text).toContain("<b>Vista:</b> prioridad | 2/2");
    expect(text).toContain("<b>Activa:</b> #1 orders_codex");
    expect(text).toContain("<b>#1 orders_codex</b> <i>requiere accion | activa</i>");
    expect(text).toContain("<b>Ruta:</b> <code>D:/xampp/htdocs/orders_codex</code>");
    expect(text).toContain("<b>Comandos:</b>\n/desktop_continue conversa\n/desktop_inspect conversa");
    expect(text).toContain("Se ocultaron 1 registros historicos del mismo repo.");
    expect(text).not.toContain("conversation-2");
  });

  it("formats an inspect view with thread details and commands", () => {
    const view = buildDesktopStatusView(status, meta);
    const inspectText = formatDesktopConversationInspectText(
      view.machineLabel,
      view.conversationViews[1]!,
    );

    expect(inspectText).toContain("<b>Thread #2</b> agent_dropshipping");
    expect(inspectText).toContain("<b>Thread:</b> Pulir onboarding");
    expect(inspectText).toContain(
      "<b>Comandos:</b>\n/desktop_continue conversa\n/desktop_inspect conversa",
    );
  });

  it("supports explicit status filters", () => {
    const inactiveView = buildDesktopStatusView(status, meta, "inactive");
    const pendingView = buildDesktopStatusView(status, meta, "pending");

    expect(inactiveView.filter).toBe("inactive");
    expect(inactiveView.conversationViews).toHaveLength(2);
    expect(inactiveView.conversationViews[0]?.title).toBe("orders_codex");
    expect(pendingView.conversationViews).toHaveLength(1);
    expect(pendingView.conversationViews[0]?.title).toBe("orders_codex");
    expect(parseDesktopStatusFilter("inactivos")).toBe("inactive");
    expect(parseDesktopStatusFilter("all")).toBe("all");
  });

  it("resolves conversation references by visible index, repo name and hidden alias id", () => {
    expect(resolveDesktopConversationReference(status, meta, "1")?.conversationId).toBe(
      "conversation-1",
    );
    expect(resolveDesktopConversationReference(status, meta, "orders_codex")?.conversationId).toBe(
      "conversation-1",
    );
    expect(resolveDesktopConversationReference(status, meta, "conversation-2")?.conversationId).toBe(
      "conversation-1",
    );
    expect(
      resolveDesktopConversationReference(status, meta, "pulir onboarding")?.conversationId,
    ).toBe("conversation-3");
  });
});
