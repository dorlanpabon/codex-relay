import { EventEmitter } from "node:events";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type {
  DesktopConversation,
  DesktopConversationContinueMode,
  DesktopStatus,
} from "@codex-relay/contracts";

import { parseDesktopLogLine } from "./log-parser.js";

export type DesktopContinueMode = "focus" | "restore" | "hybrid";
export type DesktopContinueDelivery = "focus" | "restore";

type DesktopCompanionOptions = {
  logsRoot: string;
  pollIntervalMs: number;
  defaultMaxAutoTurns: number;
  windowTitle: string;
  continueMode?: DesktopContinueMode;
  platform?: NodeJS.Platform;
  now?: () => Date;
  runContinue?: (windowTitle: string) => Promise<DesktopContinueDelivery | void>;
};

type DesktopRuntimeState = Omit<DesktopStatus, "connectorId" | "connected">;
type ConversationRuntimeState = DesktopConversation;

type LogFileSnapshot = {
  path: string;
  size: number;
  mtimeMs: number;
};

const scanLogFiles = (root: string): LogFileSnapshot[] => {
  const snapshots: LogFileSnapshot[] = [];
  const queue = [root];

  while (queue.length) {
    const current = queue.shift();
    if (!current || !existsSync(current)) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".log")) {
        continue;
      }

      const stat = statSync(entryPath);
      snapshots.push({
        path: entryPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  }

  return snapshots.sort((left, right) => right.mtimeMs - left.mtimeMs);
};

const readTail = (filePath: string, maxBytes: number): { text: string; size: number } => {
  const buffer = readFileSync(filePath);
  const start = Math.max(0, buffer.length - maxBytes);
  return {
    text: buffer.subarray(start).toString("utf8"),
    size: buffer.length,
  };
};

const readRange = (filePath: string, offset: number): { text: string; size: number } => {
  const buffer = readFileSync(filePath);
  return {
    text: buffer.subarray(offset).toString("utf8"),
    size: buffer.length,
  };
};

export const resolveContinueSequence = (mode: DesktopContinueMode): boolean[] => {
  switch (mode) {
    case "focus":
      return [false];
    case "restore":
      return [true];
    case "hybrid":
    default:
      return [false, true];
  }
};

export const buildPowerShellContinueScript = (
  windowTitle: string,
  mode: DesktopContinueMode,
): string => {
  const sequence = resolveContinueSequence(mode);
  const attemptLines = sequence
    .map((shouldRestore, index) => {
      const label = shouldRestore ? "restore" : "focus";
      const prefix = index === 0 ? "if" : "elseif";
      const flag = shouldRestore ? "$true" : "$false";
      return `${prefix} (Invoke-CodexRelayContinue $process ${flag}) { [Console]::Out.Write('${label}') }`;
    })
    .join("\n");

  return [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -TypeDefinition @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class CodexRelayWin32 {",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
    "  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);",
    "  [DllImport(\"kernel32.dll\")] public static extern uint GetCurrentThreadId();",
    "  [DllImport(\"user32.dll\")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);",
    "  [DllImport(\"user32.dll\")] public static extern bool BringWindowToTop(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool SetFocus(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);",
    "}",
    "\"@",
    `$title = '${windowTitle.replace(/'/g, "''")}'`,
    "function Resolve-CodexRelayProcess([string]$title) {",
    "  $process = Get-Process Codex -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1",
    "  if ($null -ne $process) { return $process }",
    "  if ([string]::IsNullOrWhiteSpace($title)) { return $null }",
    "  return Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like ('*' + $title + '*') } | Sort-Object StartTime -Descending | Select-Object -First 1",
    "}",
    "function Invoke-CodexRelayContinue($process, [bool]$restoreWindow) {",
    "  $hwnd = [IntPtr]::new([int64]$process.MainWindowHandle)",
    "  if ($hwnd -eq [IntPtr]::Zero) { return $false }",
    "  $foreground = [CodexRelayWin32]::GetForegroundWindow()",
    "  $foregroundPid = [uint32]0",
    "  $foregroundThread = [CodexRelayWin32]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)",
    "  $targetPid = [uint32]$process.Id",
    "  $targetThread = [CodexRelayWin32]::GetWindowThreadProcessId($hwnd, [ref]$targetPid)",
    "  $currentThread = [CodexRelayWin32]::GetCurrentThreadId()",
    "  if ($foregroundThread -ne 0) { [void][CodexRelayWin32]::AttachThreadInput($currentThread, $foregroundThread, $true) }",
    "  if ($targetThread -ne 0) { [void][CodexRelayWin32]::AttachThreadInput($currentThread, $targetThread, $true) }",
    "  try {",
    "    if ($restoreWindow) {",
    "      [void][CodexRelayWin32]::ShowWindowAsync($hwnd, 9)",
    "      [void][CodexRelayWin32]::BringWindowToTop($hwnd)",
    "      Start-Sleep -Milliseconds 150",
    "    }",
    "    $setForeground = [CodexRelayWin32]::SetForegroundWindow($hwnd)",
    "    [void][CodexRelayWin32]::SetFocus($hwnd)",
    "    Start-Sleep -Milliseconds 350",
    "    $foregroundAfter = [CodexRelayWin32]::GetForegroundWindow()",
    "    $foregroundAfterPid = [uint32]0",
    "    [void][CodexRelayWin32]::GetWindowThreadProcessId($foregroundAfter, [ref]$foregroundAfterPid)",
    "    if ((-not $setForeground) -and $foregroundAfterPid -ne $process.Id) { return $false }",
    "    Start-Sleep -Milliseconds 150",
    "    [System.Windows.Forms.SendKeys]::SendWait('continue')",
    "    Start-Sleep -Milliseconds 100",
    "    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')",
    "    return $true",
    "  } finally {",
    "    if ($targetThread -ne 0) { [void][CodexRelayWin32]::AttachThreadInput($currentThread, $targetThread, $false) }",
    "    if ($foregroundThread -ne 0) { [void][CodexRelayWin32]::AttachThreadInput($currentThread, $foregroundThread, $false) }",
    "  }",
    "}",
    "$process = Resolve-CodexRelayProcess $title",
    "if ($null -eq $process) { throw 'Codex window not found' }",
    attemptLines,
    "else { throw 'Codex window not found' }",
  ].join("\n");
};

const runPowerShellContinue = async (
  windowTitle: string,
  mode: DesktopContinueMode,
): Promise<DesktopContinueDelivery> =>
  new Promise((resolve, reject) => {
    const script = buildPowerShellContinueScript(windowTitle, mode);

    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-STA",
        "-Command",
        script,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.includes("restore") ? "restore" : "focus");
        return;
      }

      reject(new Error(stderr.trim() || `PowerShell exited with code ${code ?? "unknown"}`));
    });
  });

export const defaultCodexDesktopLogsRoot = (): string =>
  join(
    process.env.LOCALAPPDATA ?? join(os.homedir(), "AppData", "Local"),
    "Packages",
    "OpenAI.Codex_2p2nqsd0c76g0",
    "LocalCache",
    "Local",
    "Codex",
    "Logs",
  );

const conversationActivityRank = (conversation: ConversationRuntimeState): number =>
  [
    conversation.lastContinueSentAt,
    conversation.lastTurnCompletedAt,
    conversation.lastTurnStartedAt,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .find((value) => Number.isFinite(value)) ?? 0;

export class DesktopCompanion extends EventEmitter {
  private readonly platform: NodeJS.Platform;
  private readonly now: () => Date;
  private readonly continueMode: DesktopContinueMode;
  private readonly runContinueCommand: (
    windowTitle: string,
  ) => Promise<DesktopContinueDelivery | void>;
  private timer: NodeJS.Timeout | null = null;
  private cursor: { path: string; offset: number } | null = null;
  private latestWorkspacePath?: string;
  private readonly state: DesktopRuntimeState;

  constructor(private readonly options: DesktopCompanionOptions) {
    super();
    this.platform = options.platform ?? process.platform;
    this.now = options.now ?? (() => new Date());
    this.continueMode = options.continueMode ?? "hybrid";
    this.runContinueCommand =
      options.runContinue ??
      ((windowTitle) => runPowerShellContinue(windowTitle, this.continueMode));
    this.state = {
      desktopAutomationReady: false,
      autopilotEnabled: false,
      maxAutoTurns: options.defaultMaxAutoTurns,
      autoContinueCount: 0,
      conversations: [],
      note: "Desktop companion inicializando.",
    };
  }

  async start(): Promise<void> {
    await this.scanNow();
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.scanNow();
    }, this.options.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStatus(): DesktopRuntimeState {
    return {
      ...this.state,
      conversations: this.state.conversations.map((conversation) => ({ ...conversation })),
    };
  }

  async continueActive(): Promise<DesktopRuntimeState> {
    return this.continueConversation();
  }

  async continueConversation(
    conversationId?: string,
    mode: DesktopConversationContinueMode = "manual",
  ): Promise<DesktopRuntimeState> {
    this.ensureReady();
    const targetConversationId = this.resolveContinueTarget(conversationId);
    if (!targetConversationId) {
      this.state.note = "No encontre una conversacion Desktop lista para continuar.";
      this.emitStatus();
      throw new Error(this.state.note);
    }

    const conversation = this.getOrCreateConversation(targetConversationId);
    if (
      conversationId &&
      this.state.activeConversationId &&
      this.state.activeConversationId !== conversationId
    ) {
      const message = `La conversacion ${conversationId} no esta activa en Codex Desktop. Abrela y reintenta.`;
      conversation.awaitingApproval = true;
      conversation.status = "attention";
      this.setConversationNote(conversation, message);
      this.state.note = message;
      this.recomputeDerivedState();
      this.emitStatus();
      throw new Error(message);
    }

    try {
      const delivery = await this.runContinueCommand(this.options.windowTitle);
      this.applyContinueSuccess(conversation, mode, delivery);
    } catch (error) {
      this.applyContinueFailure(
        conversation,
        mode,
        error instanceof Error ? error.message : String(error),
      );
      this.emitStatus();
      throw error;
    }

    this.recomputeDerivedState();
    this.emitStatus();
    return this.getStatus();
  }

  setAutopilot(enabled: boolean, maxAutoTurns?: number): DesktopRuntimeState {
    this.ensureReady();
    if (enabled) {
      this.state.autopilotEnabled = true;
      this.state.maxAutoTurns = maxAutoTurns ?? this.state.maxAutoTurns;
      this.state.autoContinueCount = 0;
      for (const conversation of this.state.conversations) {
        conversation.autoContinueCount = 0;
      }
      this.state.note = `Autopilot activo (${this.state.maxAutoTurns} turnos max).`;
    } else {
      this.state.autopilotEnabled = false;
      this.state.note = "Autopilot detenido.";
    }

    this.recomputeDerivedState();
    this.emitStatus();
    return this.getStatus();
  }

  async scanNow(): Promise<void> {
    const before = JSON.stringify(this.state);
    this.refreshReadiness();
    if (!this.state.desktopAutomationReady) {
      if (JSON.stringify(this.state) !== before) {
        this.emitStatus();
      }
      return;
    }

    const latest = scanLogFiles(this.options.logsRoot)[0];
    if (!latest) {
      this.state.note = "No se encontraron logs recientes de Codex Desktop.";
      if (JSON.stringify(this.state) !== before) {
        this.emitStatus();
      }
      return;
    }

    if (!this.cursor || this.cursor.path !== latest.path) {
      const tail = readTail(latest.path, 262144);
      this.cursor = {
        path: latest.path,
        offset: tail.size,
      };
      await this.processChunk(tail.text);
    } else if (latest.size < this.cursor.offset) {
      const range = readRange(latest.path, 0);
      this.cursor.offset = range.size;
      await this.processChunk(range.text);
    } else if (latest.size > this.cursor.offset) {
      const range = readRange(latest.path, this.cursor.offset);
      this.cursor.offset = range.size;
      await this.processChunk(range.text);
    }

    if (JSON.stringify(this.state) !== before) {
      this.emitStatus();
    }
  }

  private refreshReadiness(): void {
    if (this.platform !== "win32") {
      this.state.desktopAutomationReady = false;
      this.state.autopilotEnabled = false;
      this.state.note = "Desktop companion solo esta disponible en Windows.";
      return;
    }

    if (!existsSync(this.options.logsRoot)) {
      this.state.desktopAutomationReady = false;
      this.state.autopilotEnabled = false;
      this.state.note = "No encontre los logs de Codex Desktop.";
      return;
    }

    this.state.desktopAutomationReady = true;
    if (!this.state.note || this.state.note.startsWith("No encontre")) {
      this.state.note = "Desktop companion listo.";
    }
  }

  private ensureReady(): void {
    this.refreshReadiness();
    if (!this.state.desktopAutomationReady) {
      throw new Error(this.state.note ?? "Desktop companion is not ready");
    }
  }

  private async processChunk(chunk: string): Promise<void> {
    const lines = chunk.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const signal = parseDesktopLogLine(line);
      if (!signal) {
        continue;
      }

      if (signal.kind === "workspace.hint") {
        this.latestWorkspacePath = signal.workspacePath;
        continue;
      }

      if (signal.kind === "turn.start") {
        const conversation = this.getOrCreateConversation(signal.conversationId);
        conversation.workspacePath = signal.workspacePath ?? this.latestWorkspacePath;
        this.setActiveConversation(signal.conversationId);
        conversation.status = "running";
        conversation.awaitingApproval = false;
        conversation.lastTurnStartedAt = this.now().toISOString();
        this.setConversationNote(conversation, `Turn detectado en ${signal.conversationId}.`);
        this.state.note = conversation.note;
        this.recomputeDerivedState();
        continue;
      }

      const conversation = this.getOrCreateConversation(signal.conversationId);
      conversation.workspacePath = signal.workspacePath ?? this.latestWorkspacePath;
      const completedAt = this.now().toISOString();
      conversation.lastTurnCompletedAt = completedAt;
      if (!this.state.activeConversationId) {
        this.setActiveConversation(signal.conversationId);
      }

      if (!this.state.autopilotEnabled) {
        conversation.awaitingApproval = true;
        conversation.status = "waiting_manual";
        this.setConversationNote(
          conversation,
          `Turn completo en ${signal.conversationId}. Esperando aprobacion remota.`,
        );
        this.state.note = conversation.note;
        this.recomputeDerivedState();
        continue;
      }

      if (conversation.autoContinueCount >= this.state.maxAutoTurns) {
        conversation.awaitingApproval = true;
        conversation.status = "attention";
        this.setConversationNote(
          conversation,
          `Autopilot no continuo ${signal.conversationId}: limite ${conversation.autoContinueCount}/${this.state.maxAutoTurns}.`,
        );
        this.state.note = conversation.note;
        this.recomputeDerivedState();
        continue;
      }

      if (
        this.state.activeConversationId &&
        signal.conversationId !== this.state.activeConversationId
      ) {
        conversation.awaitingApproval = true;
        conversation.status = "attention";
        this.setConversationNote(
          conversation,
          `Autopilot detecto que ${signal.conversationId} termino, pero no esta activa en Codex Desktop. Abrela y reintenta.`,
        );
        this.state.note = conversation.note;
        this.recomputeDerivedState();
        continue;
      }

      try {
        await this.continueConversation(signal.conversationId, "autopilot");
      } catch {
        this.recomputeDerivedState();
      }
    }
  }

  private resolveContinueTarget(requestedConversationId?: string): string | undefined {
    if (requestedConversationId) {
      return requestedConversationId;
    }

    return (
      this.state.activeConversationId ??
      this.state.conversations.find((conversation) => conversation.awaitingApproval)?.conversationId ??
      this.state.lastCompletedConversationId
    );
  }

  private getOrCreateConversation(conversationId: string): ConversationRuntimeState {
    const existing = this.state.conversations.find(
      (conversation) => conversation.conversationId === conversationId,
    );
    if (existing) {
      return existing;
    }

    const conversation: ConversationRuntimeState = {
      conversationId,
      status: "running",
      isActive: false,
      awaitingApproval: false,
      autoContinueCount: 0,
    };
    this.state.conversations.push(conversation);
    return conversation;
  }

  private setActiveConversation(conversationId: string): void {
    this.state.activeConversationId = conversationId;
    for (const conversation of this.state.conversations) {
      conversation.isActive = conversation.conversationId === conversationId;
    }
  }

  private applyContinueSuccess(
    conversation: ConversationRuntimeState,
    mode: DesktopConversationContinueMode,
    delivery: DesktopContinueDelivery | void,
  ): void {
    const timestamp = this.now().toISOString();
    conversation.awaitingApproval = false;
    conversation.lastContinueSentAt = timestamp;
    conversation.lastContinueMode = mode;
    conversation.status = mode === "autopilot" ? "auto_continue_sent" : "manual_continue_sent";
    if (mode === "autopilot") {
      conversation.autoContinueCount += 1;
    }
    this.setConversationNote(
      conversation,
      mode === "autopilot"
        ? delivery === "restore"
          ? `Autopilot envio continue a ${conversation.conversationId} ${conversation.autoContinueCount}/${this.state.maxAutoTurns} con fallback visible.`
          : `Autopilot envio continue a ${conversation.conversationId} ${conversation.autoContinueCount}/${this.state.maxAutoTurns} sin restaurar ventana.`
        : delivery === "restore"
          ? `Continue manual enviado a ${conversation.conversationId} con fallback visible.`
          : `Continue manual enviado a ${conversation.conversationId} sin restaurar ventana.`,
    );
    this.setActiveConversation(conversation.conversationId);
    this.state.note = conversation.note;
  }

  private applyContinueFailure(
    conversation: ConversationRuntimeState,
    mode: DesktopConversationContinueMode,
    reason: string,
  ): void {
    conversation.awaitingApproval = true;
    conversation.status = "attention";
    this.setConversationNote(
      conversation,
      mode === "autopilot"
        ? `Autopilot no pudo continuar ${conversation.conversationId}: ${reason}`
        : `No pude continuar ${conversation.conversationId}: ${reason}`,
    );
    this.state.note = conversation.note;
    this.recomputeDerivedState();
  }

  private setConversationNote(
    conversation: ConversationRuntimeState,
    note: string,
  ): void {
    conversation.note = note;
    conversation.lastMessagePreview = note;
  }

  private recomputeDerivedState(): void {
    const latestCompleted = [...this.state.conversations]
      .filter((conversation) => conversation.lastTurnCompletedAt)
      .sort((left, right) =>
        Date.parse(right.lastTurnCompletedAt ?? "") - Date.parse(left.lastTurnCompletedAt ?? ""),
      )[0];

    this.state.lastCompletedConversationId = latestCompleted?.conversationId;
    this.state.lastTurnCompletedAt = latestCompleted?.lastTurnCompletedAt;
    this.state.autoContinueCount = this.state.conversations.reduce(
      (total, conversation) => total + conversation.autoContinueCount,
      0,
    );
    this.state.activeConversationId = this.state.conversations.find(
      (conversation) => conversation.isActive,
    )?.conversationId;
    this.state.conversations = [...this.state.conversations].sort((left, right) => {
      if (left.awaitingApproval !== right.awaitingApproval) {
        return left.awaitingApproval ? -1 : 1;
      }
      if (left.isActive !== right.isActive) {
        return left.isActive ? -1 : 1;
      }
      const activityDiff = conversationActivityRank(right) - conversationActivityRank(left);
      return activityDiff || left.conversationId.localeCompare(right.conversationId);
    });
  }

  private emitStatus(): void {
    this.emit("desktop.status", this.getStatus());
  }
}
