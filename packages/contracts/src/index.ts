import { z } from "zod";

export const RelayPlatformSchema = z.enum(["windows", "wsl", "linux", "macos"]);
export const SessionSeveritySchema = z.enum(["info", "warning", "error", "critical"]);
export const SessionStatusSchema = z.enum([
  "queued",
  "starting",
  "running",
  "waiting_for_approval",
  "paused",
  "completed",
  "failed",
  "aborted",
]);
export const ThreadModeSchema = z.enum(["new", "resume"]);
export const ApprovalKindSchema = z.enum([
  "commandExecution",
  "fileChange",
  "toolInput",
  "network",
]);
export const ApprovalDecisionSchema = z.enum([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);
export const ControlCommandNameSchema = z.enum([
  "continue",
  "approve_once",
  "pause",
  "abort",
  "resume_thread",
]);
export const DesktopCommandNameSchema = z.enum([
  "continue_active",
  "continue_conversation",
  "autopilot_on",
  "autopilot_off",
]);
export const AutoContinueModeSchema = z.enum(["safe", "manual", "aggressive"]);

export const ConnectorProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  repoPath: z.string().min(1),
});

export const ConnectorHelloSchema = z.object({
  connectorId: z.string().min(1),
  machineName: z.string().min(1),
  platform: RelayPlatformSchema,
  codexVersion: z.string().min(1).optional(),
  appServerReady: z.boolean(),
  desktopAutomationReady: z.boolean().default(false),
  projects: z.array(ConnectorProjectSchema),
});

export const AutoContinuePolicySchema = z.object({
  mode: AutoContinueModeSchema.default("safe"),
  maxAutoTurns: z.number().int().min(0).default(5),
  continuePrompt: z
    .string()
    .default(
      "Continua hasta terminar. Solo detente si necesitas una decision real, credenciales externas, o una aclaracion imposible de inferir.",
    ),
});

export const TaskCreateSchema = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(1),
  repoPath: z.string().min(1),
  threadMode: ThreadModeSchema.default("new"),
  threadId: z.string().min(1).optional(),
  autoContinuePolicy: AutoContinuePolicySchema.default({
    mode: "safe",
    maxAutoTurns: 5,
    continuePrompt:
      "Continua hasta terminar. Solo detente si necesitas una decision real, credenciales externas, o una aclaracion imposible de inferir.",
  }),
});

export const SessionEventSchema = z.object({
  sessionId: z.string().min(1),
  type: z.string().min(1),
  severity: SessionSeveritySchema,
  timestamp: z.string().datetime(),
  summary: z.string().min(1),
  rawRef: z.string().min(1).optional(),
});

export const ApprovalRequestSchema = z.object({
  approvalId: z.string().min(1),
  sessionId: z.string().min(1),
  kind: ApprovalKindSchema,
  message: z.string().min(1),
  options: z.array(ApprovalDecisionSchema).min(1),
  expiresAt: z.string().datetime().optional(),
});

export const ControlCommandSchema = z.object({
  sessionId: z.string().min(1),
  command: ControlCommandNameSchema,
  approvalId: z.string().min(1).optional(),
  decision: ApprovalDecisionSchema.optional(),
  threadId: z.string().min(1).optional(),
});

export const DesktopCommandSchema = z.object({
  connectorId: z.string().min(1).optional(),
  command: DesktopCommandNameSchema,
  conversationId: z.string().min(1).optional(),
  maxAutoTurns: z.number().int().min(1).max(100).optional(),
});

export const PairRequestSchema = z.object({
  machineName: z.string().min(1),
  platform: RelayPlatformSchema,
  codexVersion: z.string().optional(),
  appServerReady: z.boolean().default(false),
  projects: z.array(ConnectorProjectSchema).default([]),
});

export const PairResponseSchema = z.object({
  connectorId: z.string().min(1),
  pairingToken: z.string().min(1),
  websocketUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});

export const SessionSnapshotSchema = z.object({
  id: z.string().min(1),
  connectorId: z.string().min(1),
  projectId: z.string().min(1),
  threadId: z.string().optional(),
  prompt: z.string().min(1),
  status: SessionStatusSchema,
  autoContinueTurns: z.number().int().min(0).default(0),
  autoContinuePolicy: AutoContinuePolicySchema,
  latestSummary: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const SessionResumePayloadSchema = z.object({
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  repoPath: z.string().min(1),
  prompt: z.string().min(1),
  continuePrompt: z.string().min(1),
  status: SessionStatusSchema,
});

export const DesktopConversationStatusSchema = z.enum([
  "running",
  "waiting_manual",
  "manual_continue_sent",
  "auto_continue_sent",
  "attention",
]);

export const DesktopConversationContinueModeSchema = z.enum(["manual", "autopilot"]);

export const DesktopConversationSchema = z.object({
  conversationId: z.string().min(1),
  status: DesktopConversationStatusSchema.default("running"),
  isActive: z.boolean().default(false),
  awaitingApproval: z.boolean().default(false),
  autoContinueCount: z.number().int().min(0).default(0),
  threadTitle: z.string().min(1).optional(),
  workspacePath: z.string().min(1).optional(),
  lastMessagePreview: z.string().min(1).optional(),
  lastTurnStartedAt: z.string().datetime().optional(),
  lastTurnCompletedAt: z.string().datetime().optional(),
  lastContinueSentAt: z.string().datetime().optional(),
  lastContinueMode: DesktopConversationContinueModeSchema.optional(),
  note: z.string().min(1).optional(),
});

export const DesktopStatusSchema = z.object({
  connectorId: z.string().min(1),
  connected: z.boolean().default(true),
  desktopAutomationReady: z.boolean().default(false),
  autopilotEnabled: z.boolean().default(false),
  maxAutoTurns: z.number().int().min(1).default(5),
  autoContinueCount: z.number().int().min(0).default(0),
  conversations: z.array(DesktopConversationSchema).default([]),
  activeConversationId: z.string().min(1).optional(),
  lastCompletedConversationId: z.string().min(1).optional(),
  lastTurnCompletedAt: z.string().datetime().optional(),
  note: z.string().min(1).optional(),
});

export const ConnectorCommandEnvelopeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("task.start"),
    sessionId: z.string().min(1),
    payload: TaskCreateSchema,
  }),
  z.object({
    type: z.literal("session.command"),
    sessionId: z.string().min(1),
    payload: ControlCommandSchema,
  }),
  z.object({
    type: z.literal("session.resume"),
    sessionId: z.string().min(1),
    payload: SessionResumePayloadSchema,
  }),
  z.object({
    type: z.literal("desktop.command"),
    payload: DesktopCommandSchema,
  }),
]);

export const ConnectorEventEnvelopeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("connector.hello"),
    payload: ConnectorHelloSchema,
  }),
  z.object({
    type: z.literal("session.event"),
    payload: SessionEventSchema,
  }),
  z.object({
    type: z.literal("approval.requested"),
    payload: ApprovalRequestSchema,
  }),
  z.object({
    type: z.literal("approval.resolved"),
    payload: z.object({
      approvalId: z.string().min(1),
      sessionId: z.string().min(1),
      decision: ApprovalDecisionSchema,
    }),
  }),
  z.object({
    type: z.literal("session.snapshot"),
    payload: SessionSnapshotSchema,
  }),
  z.object({
    type: z.literal("connector.error"),
    payload: z.object({
      connectorId: z.string().min(1),
      message: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal("desktop.status"),
    payload: DesktopStatusSchema,
  }),
]);

export type RelayPlatform = z.infer<typeof RelayPlatformSchema>;
export type ConnectorProject = z.infer<typeof ConnectorProjectSchema>;
export type ConnectorHello = z.infer<typeof ConnectorHelloSchema>;
export type AutoContinuePolicy = z.infer<typeof AutoContinuePolicySchema>;
export type TaskCreate = z.infer<typeof TaskCreateSchema>;
export type SessionEvent = z.infer<typeof SessionEventSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type ControlCommand = z.infer<typeof ControlCommandSchema>;
export type DesktopCommand = z.infer<typeof DesktopCommandSchema>;
export type PairRequest = z.infer<typeof PairRequestSchema>;
export type PairResponse = z.infer<typeof PairResponseSchema>;
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;
export type SessionResumePayload = z.infer<typeof SessionResumePayloadSchema>;
export type DesktopConversation = z.infer<typeof DesktopConversationSchema>;
export type DesktopStatus = z.infer<typeof DesktopStatusSchema>;
export type ConnectorCommandEnvelope = z.infer<typeof ConnectorCommandEnvelopeSchema>;
export type ConnectorEventEnvelope = z.infer<typeof ConnectorEventEnvelopeSchema>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type SessionSeverity = z.infer<typeof SessionSeveritySchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type DesktopConversationStatus = z.infer<typeof DesktopConversationStatusSchema>;
export type DesktopConversationContinueMode = z.infer<
  typeof DesktopConversationContinueModeSchema
>;

export const SAFE_CONTINUE_PROMPT =
  "Continua hasta terminar. Solo detente si necesitas una decision real, credenciales externas, o una aclaracion imposible de inferir.";

export const defaultAutoContinuePolicy = (): AutoContinuePolicy =>
  AutoContinuePolicySchema.parse({
    mode: "safe",
    maxAutoTurns: 5,
    continuePrompt: SAFE_CONTINUE_PROMPT,
  });
