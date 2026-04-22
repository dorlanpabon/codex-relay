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
    mkdirSync(join(tempDir, "2026", "04", "22"), { recursive: true });
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

    await companion.continueConversation("conversation-1");

    expect(runContinue).toHaveBeenCalledWith("Codex");
    expect(companion.getStatus().note).toContain("conversation-1");
    expect(companion.getStatus().note).toContain("fallback visible");
  });

  it("builds a focus-first PowerShell script in hybrid mode", () => {
    const script = buildPowerShellContinueScript("Codex", "hybrid");

    expect(script).toContain("if (Invoke-CodexRelayContinue $process $false)");
    expect(script).toContain("elseif (Invoke-CodexRelayContinue $process $true)");
  });
});
