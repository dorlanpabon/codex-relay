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
  runContinue?: (
    windowTitle: string,
    targetLabels?: string[],
  ) => Promise<DesktopContinueDelivery | void>;
};

type DesktopRuntimeState = Omit<DesktopStatus, "connectorId" | "connected">;
type ConversationRuntimeState = DesktopConversation;

type LogFileSnapshot = {
  path: string;
  size: number;
  mtimeMs: number;
};

type WorkspaceHint = {
  path: string;
  occurredAtMs: number;
};

type DesktopContinueTarget = {
  labels: string[];
};

const WORKSPACE_HINT_FRESHNESS_MS = 15_000;

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

  return snapshots.sort((left, right) => left.mtimeMs - right.mtimeMs);
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
  targetLabels: string[] = [],
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
  const encodedTargetLabels = targetLabels
    .map((label) => `'${label.replace(/'/g, "''")}'`)
    .join(", ");

  return [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName UIAutomationClient",
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
    "  [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y);",
    "  [DllImport(\"user32.dll\")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);",
    "}",
    "\"@",
    `$title = '${windowTitle.replace(/'/g, "''")}'`,
    `$targetLabels = @(${encodedTargetLabels})`,
    "function Resolve-CodexRelayProcess([string]$title) {",
    "  $process = Get-Process Codex -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1",
    "  if ($null -ne $process) { return $process }",
    "  if ([string]::IsNullOrWhiteSpace($title)) { return $null }",
    "  return Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like ('*' + $title + '*') } | Sort-Object StartTime -Descending | Select-Object -First 1",
    "}",
    "function Resolve-CodexRelayRoot($process) {",
    "  $hwnd = [IntPtr]::new([int64]$process.MainWindowHandle)",
    "  if ($hwnd -eq [IntPtr]::Zero) { return $null }",
    "  return [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)",
    "}",
    "function Prepare-CodexRelayWindow($process, [bool]$restoreWindow) {",
    "  $hwnd = [IntPtr]::new([int64]$process.MainWindowHandle)",
    "  if ($hwnd -eq [IntPtr]::Zero) { return $false }",
    "  if ($restoreWindow) {",
    "    [void][CodexRelayWin32]::ShowWindowAsync($hwnd, 9)",
    "    Start-Sleep -Milliseconds 120",
    "  }",
    "  [void][CodexRelayWin32]::BringWindowToTop($hwnd)",
    "  $setForeground = [CodexRelayWin32]::SetForegroundWindow($hwnd)",
    "  [void][CodexRelayWin32]::SetFocus($hwnd)",
    "  Start-Sleep -Milliseconds 180",
    "  return $setForeground",
    "}",
    "function Invoke-CodexRelayPhysicalClick($element, [int]$clickCount) {",
    "  try {",
    "    $rect = $element.Current.BoundingRectangle",
    "    if ($rect.Width -gt 1 -and $rect.Height -gt 1) {",
    "      $x = [int]($rect.X + ($rect.Width / 2))",
    "      $y = [int]($rect.Y + ($rect.Height / 2))",
    "      [void][CodexRelayWin32]::SetCursorPos($x, $y)",
    "      for ($click = 0; $click -lt [Math]::Max($clickCount, 1); $click++) {",
    "        [CodexRelayWin32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)",
    "        Start-Sleep -Milliseconds 35",
    "        [CodexRelayWin32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)",
    "        if ($click -lt ($clickCount - 1)) { Start-Sleep -Milliseconds 70 }",
    "      }",
    "      return $true",
    "    }",
    "  } catch {}",
    "  return $false",
    "}",
    "function Invoke-CodexRelayAutomationElement($element, [int]$clickCount = 1) {",
    "  if ($null -eq $element) { return $false }",
    "  try {",
    "    $element.SetFocus()",
    "  } catch {}",
    "  foreach ($pattern in @(",
    "    [System.Windows.Automation.InvokePattern]::Pattern,",
    "    [System.Windows.Automation.ScrollItemPattern]::Pattern,",
    "    [System.Windows.Automation.SelectionItemPattern]::Pattern,",
    "    [System.Windows.Automation.LegacyIAccessiblePattern]::Pattern",
    "  )) {",
    "    try {",
    "      $obj = $element.GetCurrentPattern($pattern)",
    "      if ($obj -is [System.Windows.Automation.InvokePattern]) { $obj.Invoke(); return $true }",
    "      if ($obj -is [System.Windows.Automation.ScrollItemPattern]) { $obj.ScrollIntoView(); continue }",
    "      if ($obj -is [System.Windows.Automation.SelectionItemPattern]) { $obj.Select(); return $true }",
    "      if ($obj -is [System.Windows.Automation.LegacyIAccessiblePattern]) { $obj.DoDefaultAction(); return $true }",
    "    } catch {}",
    "  }",
    "  return Invoke-CodexRelayPhysicalClick $element $clickCount",
    "}",
    "function Find-CodexRelayExactNamedElement($root, $controlType, [string]$name) {",
    "  $condition = New-Object System.Windows.Automation.AndCondition(",
    "    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $controlType)),",
    "    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name))",
    "  )",
    "  return $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)",
    "}",
    "function Find-CodexRelayPrimaryThreadButton($threadItem) {",
    "  if ($null -eq $threadItem) { return $null }",
    "  $buttonCondition = New-Object System.Windows.Automation.PropertyCondition(",
    "    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,",
    "    [System.Windows.Automation.ControlType]::Button",
    "  )",
    "  $buttons = $threadItem.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)",
    "  $bestButton = $null",
    "  $bestArea = 0",
    "  for ($i = 0; $i -lt $buttons.Count; $i++) {",
    "    $candidate = $buttons.Item($i)",
    "    if (-not $candidate.Current.IsEnabled) { continue }",
    "    $rect = $candidate.Current.BoundingRectangle",
    "    $area = [Math]::Max($rect.Width, 0) * [Math]::Max($rect.Height, 0)",
    "    if ($area -gt $bestArea) {",
    "      $bestArea = $area",
    "      $bestButton = $candidate",
    "    }",
    "  }",
    "  return $bestButton",
    "}",
    "function Open-CodexRelayThreadItem($threadItem) {",
    "  if ($null -eq $threadItem) { return $false }",
    "  $primaryButton = Find-CodexRelayPrimaryThreadButton $threadItem",
    "  if ($null -ne $primaryButton -and (Invoke-CodexRelayPhysicalClick $primaryButton 1)) {",
    "    Start-Sleep -Milliseconds 450",
    "    return $true",
    "  }",
    "  return Invoke-CodexRelayPhysicalClick $threadItem 2",
    "}",
    "function Select-CodexRelayFirstProjectThread($root, [string]$projectLabel) {",
    "  if ([string]::IsNullOrWhiteSpace($projectLabel)) { return $null }",
    "  $projectButton = Find-CodexRelayExactNamedElement $root [System.Windows.Automation.ControlType]::Button $projectLabel",
    "  if ($null -eq $projectButton) { return $null }",
    "  if (-not (Invoke-CodexRelayAutomationElement $projectButton 1)) { return $null }",
    "  Start-Sleep -Milliseconds 250",
    "  $listName = 'Automations in ' + $projectLabel",
    "  $projectList = Find-CodexRelayExactNamedElement $root [System.Windows.Automation.ControlType]::List $listName",
    "  if ($null -eq $projectList) { return $null }",
    "  $itemCondition = New-Object System.Windows.Automation.PropertyCondition(",
    "    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,",
    "    [System.Windows.Automation.ControlType]::ListItem",
    "  )",
    "  $items = $projectList.FindAll([System.Windows.Automation.TreeScope]::Descendants, $itemCondition)",
    "  for ($i = 0; $i -lt $items.Count; $i++) {",
    "    $candidate = $items.Item($i)",
    "    if (-not $candidate.Current.IsEnabled) { continue }",
    "    $candidateName = $candidate.Current.Name",
    "    if ([string]::IsNullOrWhiteSpace($candidateName)) { continue }",
    "    if (Open-CodexRelayThreadItem $candidate) {",
    "      Start-Sleep -Milliseconds 400",
    "      return $candidateName.Trim()",
    "    }",
    "  }",
    "  return $null",
    "}",
    "function Select-CodexRelayTarget($root, [string[]]$labels) {",
    "  if ($null -eq $root -or $null -eq $labels -or $labels.Count -eq 0) { return $null }",
    "  foreach ($label in $labels) {",
    "    if ([string]::IsNullOrWhiteSpace($label)) { continue }",
    "    $name = $label.Trim()",
    "    $projectList = Find-CodexRelayExactNamedElement $root [System.Windows.Automation.ControlType]::List ('Automations in ' + $name)",
    "    if ($null -ne $projectList) {",
    "      $selectedProjectThread = Select-CodexRelayFirstProjectThread $root $name",
    "      if (-not [string]::IsNullOrWhiteSpace($selectedProjectThread)) { return $selectedProjectThread }",
    "      continue",
    "    }",
    "    $threadItem = Find-CodexRelayExactNamedElement $root [System.Windows.Automation.ControlType]::ListItem $name",
    "    if ($null -ne $threadItem) {",
    "      if (Open-CodexRelayThreadItem $threadItem) {",
    "        Start-Sleep -Milliseconds 400",
    "        return $name",
    "      }",
    "    }",
    "    $button = Find-CodexRelayExactNamedElement $root [System.Windows.Automation.ControlType]::Button $name",
    "    if ($null -ne $button -and (Invoke-CodexRelayAutomationElement $button 1)) {",
    "      Start-Sleep -Milliseconds 250",
    "      return $name",
    "    }",
    "  }",
    "  return $null",
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
    "if ($targetLabels.Count -gt 0) {",
    "  if (-not (Prepare-CodexRelayWindow $process $true)) { throw 'Codex window could not be focused for target selection' }",
    "  $root = Resolve-CodexRelayRoot $process",
    "  if ($null -eq $root) { throw 'Codex automation root not found' }",
    "  $selectedTarget = Select-CodexRelayTarget $root $targetLabels",
    "  if ([string]::IsNullOrWhiteSpace($selectedTarget)) {",
    "    throw ('Codex target not found: ' + ($targetLabels -join ', '))",
    "  }",
    "}",
    attemptLines,
    "else { throw 'Codex window not found' }",
  ].join("\n");
};

const runPowerShellContinue = async (
  windowTitle: string,
  mode: DesktopContinueMode,
  targetLabels: string[] = [],
): Promise<DesktopContinueDelivery> =>
  new Promise((resolve, reject) => {
    const script = buildPowerShellContinueScript(windowTitle, mode, targetLabels);

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

const parseTimestamp = (value?: string): number => {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const hasPendingTurn = (conversation: ConversationRuntimeState): boolean =>
  parseTimestamp(conversation.lastTurnStartedAt) > parseTimestamp(conversation.lastTurnCompletedAt);

const hasQueuedContinue = (conversation: ConversationRuntimeState): boolean =>
  conversation.status === "manual_continue_sent" || conversation.status === "auto_continue_sent";

const isConversationVisiblyRunning = (conversation: ConversationRuntimeState): boolean =>
  conversation.isActive &&
  !conversation.awaitingApproval &&
  (hasPendingTurn(conversation) || hasQueuedContinue(conversation));

const normalizeLookupValue = (value?: string): string =>
  value
    ?.trim()
    .toLowerCase()
    .replace(/[\\/]+/g, "/")
    .replace(/\s+/g, " ") ?? "";

const workspaceFolderName = (workspacePath?: string): string | undefined => {
  if (!workspacePath) {
    return undefined;
  }

  const parts = workspacePath.split(/[\\/]/).filter(Boolean);
  return parts.at(-1);
};

const hasMeaningfulThreadTitle = (conversation: ConversationRuntimeState): boolean => {
  const title = conversation.threadTitle?.trim();
  if (!title) {
    return false;
  }

  const normalizedTitle = normalizeLookupValue(title);
  const normalizedConversationId = normalizeLookupValue(conversation.conversationId);
  if (
    normalizedTitle === normalizedConversationId ||
    normalizedTitle === normalizeLookupValue(conversation.conversationId.slice(0, 8))
  ) {
    return false;
  }

  return !/^[0-9a-f-]{8,}$/i.test(title);
};

export class DesktopCompanion extends EventEmitter {
  private readonly platform: NodeJS.Platform;
  private readonly now: () => Date;
  private readonly continueMode: DesktopContinueMode;
  private readonly runContinueCommand: (
    windowTitle: string,
    targetLabels?: string[],
  ) => Promise<DesktopContinueDelivery | void>;
  private timer: NodeJS.Timeout | null = null;
  private readonly fileOffsets = new Map<string, number>();
  private latestWorkspaceHint?: WorkspaceHint;
  private readonly state: DesktopRuntimeState;

  constructor(private readonly options: DesktopCompanionOptions) {
    super();
    this.platform = options.platform ?? process.platform;
    this.now = options.now ?? (() => new Date());
    this.continueMode = options.continueMode ?? "hybrid";
    this.runContinueCommand =
      options.runContinue ??
      ((windowTitle, targetLabels) =>
        runPowerShellContinue(windowTitle, this.continueMode, targetLabels));
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
    const continueTarget = this.resolveContinueTargetLabels(conversation);
    if (!conversation.isActive && !continueTarget) {
      const message = `No pude seleccionar ${this.describeConversation(conversation)} de forma segura en Codex Desktop. Abre ese thread y reintenta.`;
      conversation.awaitingApproval = true;
      conversation.status = "attention";
      this.setConversationNote(conversation, message);
      this.state.note = message;
      this.recomputeDerivedState();
      this.emitStatus();
      throw new Error(message);
    }

    try {
      const delivery = await this.runContinueCommand(
        this.options.windowTitle,
        continueTarget?.labels ?? [],
      );
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

    const logFiles = scanLogFiles(this.options.logsRoot);
    if (logFiles.length === 0) {
      this.state.note = "No se encontraron logs recientes de Codex Desktop.";
      if (JSON.stringify(this.state) !== before) {
        this.emitStatus();
      }
      return;
    }

    const livePaths = new Set(logFiles.map((logFile) => logFile.path));
    for (const trackedPath of this.fileOffsets.keys()) {
      if (!livePaths.has(trackedPath)) {
        this.fileOffsets.delete(trackedPath);
      }
    }

    for (const logFile of logFiles) {
      const previousOffset = this.fileOffsets.get(logFile.path);
      const offset =
        previousOffset === undefined || logFile.size < previousOffset ? 0 : previousOffset;
      if (logFile.size === offset) {
        continue;
      }

      const range = readRange(logFile.path, offset);
      this.fileOffsets.set(logFile.path, range.size);
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
        this.latestWorkspaceHint = {
          path: signal.workspacePath,
          occurredAtMs: parseTimestamp(signal.occurredAt) || this.now().getTime(),
        };
        continue;
      }

      if (signal.kind === "turn.start") {
        const conversation = this.getOrCreateConversation(signal.conversationId);
        const signalTimestamp = signal.occurredAt ?? this.now().toISOString();
        this.assignWorkspacePath(conversation, signal.workspacePath, signalTimestamp);
        this.setActiveConversation(signal.conversationId);
        conversation.status = "running";
        conversation.awaitingApproval = false;
        conversation.lastTurnStartedAt = signalTimestamp;
        this.setConversationNote(conversation, `Turn detectado en ${signal.conversationId}.`);
        this.state.note = conversation.note;
        this.recomputeDerivedState();
        continue;
      }

      const conversation = this.getOrCreateConversation(signal.conversationId);
      const completedAt = signal.occurredAt ?? this.now().toISOString();
      this.assignWorkspacePath(conversation, signal.workspacePath, completedAt);
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

  private resolveContinueTargetLabels(
    conversation: ConversationRuntimeState,
  ): DesktopContinueTarget | undefined {
    if (conversation.isActive) {
      return undefined;
    }

    const labels: string[] = [];
    const threadTitle = hasMeaningfulThreadTitle(conversation)
      ? conversation.threadTitle?.trim()
      : undefined;
    if (threadTitle && this.isUniqueThreadTitle(threadTitle, conversation.conversationId)) {
      labels.push(threadTitle);
    }

    const folderName = workspaceFolderName(conversation.workspacePath);
    if (folderName && this.canSelectWorkspaceFolder(folderName, conversation.conversationId)) {
      labels.push(folderName);
    }

    const dedupedLabels = [...new Set(labels.filter(Boolean))];
    if (dedupedLabels.length === 0) {
      return undefined;
    }

    return {
      labels: dedupedLabels,
    };
  }

  private isUniqueThreadTitle(title: string, conversationId: string): boolean {
    const normalizedTitle = normalizeLookupValue(title);
    return (
      this.state.conversations.filter((candidate) => {
        if (candidate.conversationId === conversationId || !hasMeaningfulThreadTitle(candidate)) {
          return false;
        }
        return normalizeLookupValue(candidate.threadTitle) === normalizedTitle;
      }).length === 0
    );
  }

  private canSelectWorkspaceFolder(folderName: string, conversationId: string): boolean {
    const normalizedFolder = normalizeLookupValue(folderName);
    const sameFolderCandidates = this.state.conversations.filter(
      (candidate) =>
        normalizeLookupValue(workspaceFolderName(candidate.workspacePath)) === normalizedFolder,
    );
    if (sameFolderCandidates.length === 0) {
      return false;
    }

    const requestedConversation = sameFolderCandidates.find(
      (candidate) => candidate.conversationId === conversationId,
    );
    if (!requestedConversation) {
      return false;
    }

    const normalizedWorkspace = normalizeLookupValue(requestedConversation.workspacePath);
    if (
      normalizedWorkspace &&
      sameFolderCandidates.some(
        (candidate) =>
          normalizeLookupValue(candidate.workspacePath) !== normalizedWorkspace,
      )
    ) {
      return false;
    }

    const primaryConversation = [...sameFolderCandidates].sort((left, right) => {
      const activityDiff = conversationActivityRank(right) - conversationActivityRank(left);
      if (activityDiff) {
        return activityDiff;
      }
      if (left.isActive !== right.isActive) {
        return left.isActive ? -1 : 1;
      }
      if (left.awaitingApproval !== right.awaitingApproval) {
        return left.awaitingApproval ? -1 : 1;
      }
      return left.conversationId.localeCompare(right.conversationId);
    })[0];

    return primaryConversation?.conversationId === conversationId;
  }

  private describeConversation(conversation: ConversationRuntimeState): string {
    return (
      conversation.threadTitle?.trim() ||
      workspaceFolderName(conversation.workspacePath) ||
      conversation.conversationId
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
      status: "idle",
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

  private assignWorkspacePath(
    conversation: ConversationRuntimeState,
    explicitWorkspacePath: string | undefined,
    occurredAt: string,
  ): void {
    if (explicitWorkspacePath) {
      conversation.workspacePath = explicitWorkspacePath;
      return;
    }

    if (conversation.workspacePath) {
      return;
    }

    const hint = this.latestWorkspaceHint;
    if (!hint) {
      return;
    }

    const occurredAtMs = parseTimestamp(occurredAt);
    if (!occurredAtMs || occurredAtMs - hint.occurredAtMs > WORKSPACE_HINT_FRESHNESS_MS) {
      return;
    }

    conversation.workspacePath = hint.path;
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
    for (const conversation of this.state.conversations) {
      if (conversation.awaitingApproval) {
        continue;
      }

      if (isConversationVisiblyRunning(conversation)) {
        if (conversation.status === "idle") {
          conversation.status = "running";
        }
        continue;
      }

      if (
        conversation.status === "running" ||
        conversation.status === "manual_continue_sent" ||
        conversation.status === "auto_continue_sent"
      ) {
        conversation.status = "idle";
      }
    }
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
