import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DesktopCompanion,
  defaultCodexDesktopLogsRoot,
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

    companion.stop();
  });

  it("exposes the packaged desktop logs path by default", () => {
    expect(defaultCodexDesktopLogsRoot()).toContain("OpenAI.Codex_2p2nqsd0c76g0");
  });
});
