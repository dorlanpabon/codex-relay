import { describe, expect, it } from "vitest";

import {
  buildDesktopStatusView,
  formatDesktopConversationInspectText,
  formatDesktopStatusText,
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
    note: "Turn completo en conversation-2. Esperando aprobacion remota.",
    conversations: [
      {
        conversationId: "conversation-1",
        status: "running" as const,
        isActive: true,
        awaitingApproval: false,
        autoContinueCount: 0,
        threadTitle: "Corregir login SENA",
        workspacePath: "D:/xampp/htdocs/orders_codex",
        lastMessagePreview: "Estoy validando el flujo de login y ajustando cookies.",
      },
      {
        conversationId: "conversation-2",
        status: "waiting_manual" as const,
        isActive: false,
        awaitingApproval: true,
        autoContinueCount: 0,
        workspacePath: "D:/xampp/htdocs/agent_dropshipping",
        threadTitle: "Pulir onboarding",
        note: "Turn completo en conversation-2. Esperando aprobacion remota.",
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

  it("formats desktop status with thread labels, summaries and command hints", () => {
    const view = buildDesktopStatusView(status, meta);
    const text = formatDesktopStatusText(view);

    expect(text).toContain("Codex Desktop | DESKTOP-DEV");
    expect(text).toContain("Activa: #1 orders_codex");
    expect(text).toContain("#2 agent_dropshipping | requiere accion");
    expect(text).toContain("Thread: Corregir login SENA");
    expect(text).toContain("Ultimo estado: Estoy validando el flujo de login");
    expect(text).toContain("Acciones: /desktop_continue 2 | /desktop_inspect 2");
    expect(text).not.toContain("conversation-2");
  });

  it("formats an inspect view with thread and command details", () => {
    const view = buildDesktopStatusView(status, meta);
    const inspectText = formatDesktopConversationInspectText(
      view.machineLabel,
      view.conversationViews[0]!,
    );

    expect(inspectText).toContain("Thread #1 orders_codex");
    expect(inspectText).toContain("Thread: Corregir login SENA");
    expect(inspectText).toContain("Acciones: /desktop_continue 1 | /desktop_inspect 1");
  });

  it("resolves conversation references by index, project name and thread name", () => {
    expect(resolveDesktopConversationReference(status, meta, "2")?.conversationId).toBe(
      "conversation-2",
    );
    expect(
      resolveDesktopConversationReference(status, meta, "agent_dropshipping")?.conversationId,
    ).toBe("conversation-2");
    expect(
      resolveDesktopConversationReference(status, meta, "pulir onboarding")?.conversationId,
    ).toBe("conversation-2");
    expect(resolveDesktopConversationReference(status, meta, "onboarding")?.conversationId).toBe(
      "conversation-2",
    );
  });
});
