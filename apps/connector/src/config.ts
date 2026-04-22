import os from "node:os";
import { z } from "zod";

import {
  defaultCodexDesktopLogsRoot,
  defaultCodexThreadStateDbPath,
  type DesktopContinueMode,
} from "./desktop/companion.js";
import { loadEnvFiles } from "./env/load-env.js";
import { defaultStateFilePath } from "./state/connector-state.js";

const desktopContinueModes = ["focus", "restore", "hybrid"] as const satisfies readonly DesktopContinueMode[];

const ConfigSchema = z.object({
  API_BASE_URL: z.string().default("http://localhost:4000"),
  RELAY_USER_ID: z.string().default("local-dev-user"),
  CONNECTOR_ID: z.string().optional(),
  PAIRING_TOKEN: z.string().optional(),
  WEBSOCKET_URL: z.string().optional(),
  PROJECTS: z.string().optional(),
  CODEX_COMMAND: z.string().default("codex"),
  MACHINE_NAME: z.string().default(os.hostname()),
  RECONNECT_DELAY_MS: z.coerce.number().int().positive().default(3000),
  STATE_FILE_PATH: z.string().default(defaultStateFilePath()),
  DESKTOP_AUTOMATION_ENABLED: z.coerce.boolean().default(true),
  DESKTOP_LOGS_ROOT: z.string().default(defaultCodexDesktopLogsRoot()),
  DESKTOP_THREADS_DB_PATH: z.string().default(defaultCodexThreadStateDbPath()),
  DESKTOP_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  DESKTOP_AUTOPILOT_MAX_TURNS: z.coerce.number().int().positive().default(8),
  DESKTOP_WINDOW_TITLE: z.string().default("Codex"),
  DESKTOP_CONTINUE_MODE: z.enum(desktopContinueModes).default("hybrid"),
});

export type ConnectorConfig = z.infer<typeof ConfigSchema>;

let cachedConfig: ConnectorConfig | null = null;

export const loadConfig = (): ConnectorConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  loadEnvFiles();
  cachedConfig = ConfigSchema.parse(process.env);
  return cachedConfig;
};
