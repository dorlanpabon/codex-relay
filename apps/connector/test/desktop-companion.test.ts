import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildPowerShellContinueScript,
  DesktopCompanion,
  defaultCodexDesktopLogsRoot,
  resolveContinueSequence,
} from "../src/desktop/companion.js";

describe("DesktopCompanion", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects completion and can enable autopilot", async () => {
    const tempDir = mkdtempSync(join(os.tmpdir(), "codex-relay-desktop-"));
    tempDirs.push(tempDir);
    const dayDir = join(tempDir, "2026", "04", "22");
    mkdirSync(dayDir, { recursive: true });
    const logPath = join(dayDir, "codex.log");
    writeFileSync(
      logPath,
      [
        "[electron-message-handler] method=turn/start conversationId=conversation-1",
        "[electron-message-handler] [desktop-notifications] show turn-complete conversationId=conversation-1",
        "",
      ].join("\n"),
      "utf8",
    );
    const runContinue = vi.fn().mockResolvedValue(undefined);
    const companion = new DesktopCompanion({
      logsRoot: tempDir,
      pollIntervalMs: 60_000,
      defaultMaxAutoTurns: 3,
      platform: "win32",
      windowTitle: "Codex",
      runContinue,
      now: () => new Date("2026-04-22T12:00:00.000Z"),
    });

    await companion.start();
    expect(companion.getStatus().desktopAutomationReady).toBe(true);
    expect(companion.getStatus().lastCompletedConversationId).toBe("conversation-1");
    expect(companion.getStatus().conversations).toHaveLength(1);
    expect(companion.getStatus().conversations[0]).toMatchObject({
      conversationId: "conversation-1",
      status: "waiting_manual",
      awaitingApproval: true,
      lastMessagePreview: "Turn completo en conversation-1. Esperando aprobacion remota.",
    });

    companion.setAutopilot(true, 2);
    appendFileSync(
      logPath,
      "[electron-message-handler] [desktop-notifications] show turn-complete conversationId=conversation-1\n",
      "utf8",
    );
    await companion.scanNow();

    expect(runContinue).toHaveBeenCalledTimes(1);
    expect(companion.getStatus()).toMatchObject({
      autopilotEnabled: true,
      autoContinueCount: 1,
      maxAutoTurns: 2,
    });
    expect(companion.getStatus().conversations[0]).toMatchObject({
      conversationId: "conversation-1",
      status: "auto_continue_sent",
      autoContinueCount: 1,
      awaitingApproval: false,
      lastContinueMode: "autopilot",
    });

    companion.stop();
  });

  it("keeps background thread completions in manual approval instead of sending continue blindly", async () => {
    const tempDir = mkdtempSync(join(os.tmpdir(), "codex-relay-desktop-"));
    tempDirs.push(tempDir);
    const dayDir = join(tempDir, "2026", "04", "22");
    mkdirSync(dayDir, { recursive: true });
    const logPath = join(dayDir, "codex.log");
    writeFileSync(
      logPath,
      [
        "[electron-message-handler] method=turn/start conversationId=conversation-1",
        "",
      ].join("\n"),
      "utf8",
    );
    const runContinue = vi.fn().mockResolvedValue("focus");
    const companion = new DesktopCompanion({
      logsRoot: tempDir,
      pollIntervalMs: 60_000,
      defaultMaxAutoTurns: 3,
      platform: "win32",
      windowTitle: "Codex",
      runContinue,
      now: () => new Date("2026-04-22T12:00:00.000Z"),
    });

    await companion.start();
    companion.setAutopilot(true, 2);
    appendFileSync(
      logPath,
      [
        "[electron-message-handler] method=turn/start conversationId=conversation-2",
        "[electron-message-handler] [desktop-notifications] show turn-complete conversationId=conversation-1",
        "",
      ].join("\n"),
      "utf8",
    );
    await companion.scanNow();

    expect(runContinue).not.toHaveBeenCalled();
    expect(companion.getStatus().activeConversationId).toBe("conversation-2");
    expect(companion.getStatus().conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conversationId: "conversation-1",
          status: "attention",
          awaitingApproval: true,
        }),
        expect.objectContaining({
          conversationId: "conversation-2",
          status: "running",
          isActive: true,
        }),
      ]),
    );
  });

  it("treats only the visible active thread as running and preserves log timestamps", async () => {
    const tempDir = mkdtempSync(join(os.tmpdir(), "codex-relay-desktop-"));
    tempDirs.push(tempDir);
    const dayDir = join(tempDir, "2026", "04", "22");
    mkdirSync(dayDir, { recursive: true });
    const logPath = join(dayDir, "codex.log");
    writeFileSync(
      logPath,
      [
        "2026-04-22T12:00:00.000Z info [ElectronAppServerConnection] response_routed conversationId=conversation-1 method=turn/start",
        "2026-04-22T12:05:00.000Z info [ElectronAppServerConnection] response_routed conversationId=conversation-2 method=turn/start",
        "",
      ].join("\n"),
      "utf8",
    );
    const companion = new DesktopCompanion({
      logsRoot: tempDir,
      pollIntervalMs: 60_000,
      defaultMaxAutoTurns: 3,
      platform: "win32",
      windowTitle: "Codex",
      runContinue: vi.fn().mockResolvedValue("focus"),
      now: () => new Date("2026-04-22T14:00:00.000Z"),
    });

    await companion.start();

    expect(companion.getStatus().activeConversationId).toBe("conversation-2");
    expect(companion.getStatus().conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conversationId: "conversation-1",
          status: "idle",
          isActive: false,
          lastTurnStartedAt: "2026-04-22T12:00:00.000Z",
        }),
        expect.objectContaining({
          conversationId: "conversation-2",
          status: "running",
          isActive: true,
          lastTurnStartedAt: "2026-04-22T12:05:00.000Z",
        }),
      ]),
    );
  });

  it("hydrates conversations from every desktop log file instead of only the latest one", async () => {
    const tempDir = mkdtempSync(join(os.tmpdir(), "codex-relay-desktop-"));
    tempDirs.push(tempDir);
    const oldDayDir = join(tempDir, "2026", "04", "21");
    const newDayDir = join(tempDir, "2026", "04", "22");
    mkdirSync(oldDayDir, { recursive: true });
    mkdirSync(newDayDir, { recursive: true });
    writeFileSync(
      join(oldDayDir, "old.log"),
      [
        "2026-04-21T12:01:00.000Z info [ElectronAppServerConnection] response_routed conversationId=conversation-1 method=turn/start cwd=D:\\xampp\\htdocs\\orders_codex",
        "2026-04-21T12:03:00.000Z info [desktop-notifications] [desktop-notifications] show turn-complete conversationId=conversation-1 cwd=D:\\xampp\\htdocs\\orders_codex",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(newDayDir, "new.log"),
      [
        "2026-04-22T12:06:00.000Z info [ElectronAppServerConnection] response_routed conversationId=conversation-2 method=turn/start cwd=D:\\xampp\\htdocs\\tv_controller",
        "",
      ].join("\n"),
      "utf8",
    );
    const companion = new DesktopCompanion({
      logsRoot: tempDir,
      pollIntervalMs: 60_000,
      defaultMaxAutoTurns: 3,
      platform: "win32",
      windowTitle: "Codex",
      runContinue: vi.fn().mockResolvedValue("focus"),
      now: () => new Date("2026-04-22T14:00:00.000Z"),
    });

    await companion.start();

    expect(companion.getStatus().conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conversationId: "conversation-1",
          workspacePath: "D:/xampp/htdocs/orders_codex",
          status: "waiting_manual",
        }),
        expect.objectContaining({
          conversationId: "conversation-2",
          workspacePath: "D:/xampp/htdocs/tv_controller",
          status: "running",
        }),
      ]),
    );
  });

  it("keeps the first known workspace for a thread when another repo logs a newer hint", async () => {
    const tempDir = mkdtempSync(join(os.tmpdir(), "codex-relay-desktop-"));
    tempDirs.push(tempDir);
    const dayDir = join(tempDir, "2026", "04", "22");
    mkdirSync(dayDir, { recursive: true });
    const logPath = join(dayDir, "codex.log");
    writeFileSync(
      logPath,
      [
        "2026-04-22T12:00:00.000Z info [git] git.command.complete cwd=D:\\xampp\\htdocs\\orders_codex durationMs=168",
        "2026-04-22T12:00:05.000Z info [ElectronAppServerConnection] response_routed conversationId=conversation-1 method=turn/start",
        "2026-04-22T12:05:00.000Z info [git] git.command.complete cwd=D:\\xampp\\htdocs\\tv_controller durationMs=168",
        "2026-04-22T12:05:05.000Z info [ElectronAppServerConnection] response_routed conversationId=conversation-2 method=turn/start",
        "2026-04-22T12:05:08.000Z info [desktop-notifications] [desktop-notifications] show turn-complete conversationId=conversation-1",
        "",
      ].join("\n"),
      "utf8",
    );
    const companion = new DesktopCompanion({
      logsRoot: tempDir,
      pollIntervalMs: 60_000,
      defaultMaxAutoTurns: 3,
      platform: "win32",
      windowTitle: "Codex",
      runContinue: vi.fn().mockResolvedValue("focus"),
      now: () => new Date("2026-04-22T14:00:00.000Z"),
    });

    await companion.start();

    expect(companion.getStatus().conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conversationId: "conversation-1",
          workspacePath: "D:/xampp/htdocs/orders_codex",
        }),
        expect.objectContaining({
          conversationId: "conversation-2",
          workspacePath: "D:/xampp/htdocs/tv_controller",
        }),
      ]),
    );
  });

  it("exposes the packaged desktop logs path by default", () => {
    expect(defaultCodexDesktopLogsRoot()).toContain("OpenAI.Codex_2p2nqsd0c76g0");
  });

  it("uses a hybrid continue sequence by default", () => {
    expect(resolveContinueSequence("hybrid")).toEqual([false, true]);
    expect(resolveContinueSequence("focus")).toEqual([false]);
    expect(resolveContinueSequence("restore")).toEqual([true]);
  });

  it("marks visible fallback when continue needed a restore", async () => {
    const tempDir = mkdtempSync(join(os.tmpdir(), "codex-relay-desktop-"));
    tempDirs.push(tempDir);
    const dayDir = join(tempDir, "2026", "04", "22");
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(
      join(dayDir, "codex.log"),
      "2026-04-22T12:00:00.000Z info [ElectronAppServerConnection] response_routed conversationId=conversation-1 method=turn/start cwd=D:\\xampp\\htdocs\\orders_codex\n",
      "utf8",
    );
    const runContinue = vi.fn().mockResolvedValue("restore");
    const companion = new DesktopCompanion({
      logsRoot: tempDir,
      pollIntervalMs: 60_000,
      defaultMaxAutoTurns: 3,
      platform: "win32",
      windowTitle: "Codex",
      runContinue,
      now: () => new Date("2026-04-22T12:00:00.000Z"),
    });

    await companion.start();
    await companion.continueConversation("conversation-1");

    expect(runContinue).toHaveBeenCalledWith("Codex", []);
    expect(companion.getStatus().note).toContain("conversation-1");
    expect(companion.getStatus().note).toContain("fallback visible");
  });

  it("selects a unique project before continuing an inactive thread", async () => {
    const tempDir = mkdtempSync(join(os.tmpdir(), "codex-relay-desktop-"));
    tempDirs.push(tempDir);
    const dayDir = join(tempDir, "2026", "04", "22");
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(
      join(dayDir, "codex.log"),
      [
        "2026-04-22T12:00:00.000Z info [ElectronAppServerConnection] response_routed conversationId=conversation-1 method=turn/start cwd=D:\\xampp\\htdocs\\my_home_smart",
        "2026-04-22T12:01:00.000Z info [desktop-notifications] [desktop-notifications] show turn-complete conversationId=conversation-1 cwd=D:\\xampp\\htdocs\\my_home_smart",
        "2026-04-22T12:02:00.000Z info [ElectronAppServerConnection] response_routed conversationId=conversation-2 method=turn/start cwd=D:\\xampp\\htdocs\\extension_zajuna_automatization",
        "",
      ].join("\n"),
      "utf8",
    );
    const runContinue = vi.fn().mockResolvedValue("focus");
    const companion = new DesktopCompanion({
      logsRoot: tempDir,
      pollIntervalMs: 60_000,
      defaultMaxAutoTurns: 3,
      platform: "win32",
      windowTitle: "Codex",
      runContinue,
      now: () => new Date("2026-04-22T12:05:00.000Z"),
    });

    await companion.start();
    await companion.continueConversation("conversation-1");

    expect(runContinue).toHaveBeenCalledWith("Codex", ["my_home_smart"]);
    expect(companion.getStatus().activeConversationId).toBe("conversation-1");
  });

  it("blocks continue when multiple tracked threads share the same project label", async () => {
    const tempDir = mkdtempSync(join(os.tmpdir(), "codex-relay-desktop-"));
    tempDirs.push(tempDir);
    const dayDir = join(tempDir, "2026", "04", "22");
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(
      join(dayDir, "codex.log"),
      [
        "2026-04-22T12:00:00.000Z info [ElectronAppServerConnection] response_routed conversationId=conversation-1 method=turn/start cwd=D:\\xampp\\htdocs\\orders_codex",
        "2026-04-22T12:01:00.000Z info [desktop-notifications] [desktop-notifications] show turn-complete conversationId=conversation-1 cwd=D:\\xampp\\htdocs\\orders_codex",
        "2026-04-22T12:02:00.000Z info [ElectronAppServerConnection] response_routed conversationId=conversation-2 method=turn/start cwd=D:\\xampp\\htdocs\\orders_codex",
        "",
      ].join("\n"),
      "utf8",
    );
    const runContinue = vi.fn().mockResolvedValue("focus");
    const companion = new DesktopCompanion({
      logsRoot: tempDir,
      pollIntervalMs: 60_000,
      defaultMaxAutoTurns: 3,
      platform: "win32",
      windowTitle: "Codex",
      runContinue,
      now: () => new Date("2026-04-22T12:05:00.000Z"),
    });

    await companion.start();

    await expect(companion.continueConversation("conversation-1")).rejects.toThrow(
      /No pude seleccionar orders_codex de forma segura/i,
    );
    expect(runContinue).not.toHaveBeenCalled();
  });

  it("allows continue for the visible representative when older history exists for the same project", async () => {
    const tempDir = mkdtempSync(join(os.tmpdir(), "codex-relay-desktop-"));
    tempDirs.push(tempDir);
    const dayDir = join(tempDir, "2026", "04", "22");
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(
      join(dayDir, "codex.log"),
      [
        "2026-04-21T12:00:00.000Z info [ElectronAppServerConnection] response_routed conversationId=conversation-1 method=turn/start cwd=D:\\xampp\\htdocs\\my_home_smart",
        "2026-04-21T12:01:00.000Z info [desktop-notifications] [desktop-notifications] show turn-complete conversationId=conversation-1 cwd=D:\\xampp\\htdocs\\my_home_smart",
        "2026-04-22T12:02:00.000Z info [ElectronAppServerConnection] response_routed conversationId=conversation-2 method=turn/start cwd=D:\\xampp\\htdocs\\my_home_smart",
        "2026-04-22T12:03:00.000Z info [desktop-notifications] [desktop-notifications] show turn-complete conversationId=conversation-2 cwd=D:\\xampp\\htdocs\\my_home_smart",
        "2026-04-22T12:04:00.000Z info [ElectronAppServerConnection] response_routed conversationId=conversation-3 method=turn/start cwd=D:\\xampp\\htdocs\\extension_zajuna_automatization",
        "",
      ].join("\n"),
      "utf8",
    );
    const runContinue = vi.fn().mockResolvedValue("focus");
    const companion = new DesktopCompanion({
      logsRoot: tempDir,
      pollIntervalMs: 60_000,
      defaultMaxAutoTurns: 3,
      platform: "win32",
      windowTitle: "Codex",
      runContinue,
      now: () => new Date("2026-04-22T12:05:00.000Z"),
    });

    await companion.start();
    await companion.continueConversation("conversation-2");

    expect(runContinue).toHaveBeenCalledWith("Codex", ["my_home_smart"]);
    await expect(companion.continueConversation("conversation-1")).rejects.toThrow(
      /No pude seleccionar my_home_smart de forma segura/i,
    );
  });

  it("builds a focus-first PowerShell script in hybrid mode", () => {
    const script = buildPowerShellContinueScript("Codex", "hybrid");

    expect(script).toContain("if (Invoke-CodexRelayContinue $process $false)");
    expect(script).toContain("elseif (Invoke-CodexRelayContinue $process $true)");
  });
});
