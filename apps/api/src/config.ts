import { z } from "zod";

import { loadEnvFiles } from "./env/load-env.js";

const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:54329/codex_relay?schema=public";
const DEFAULT_REDIS_URL = "redis://localhost:63799";

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default(DEFAULT_REDIS_URL),
  RELAY_PUBLIC_WS_URL: z.string().default("ws://localhost:4000/connectors"),
  DEFAULT_USER_ID: z.string().min(1).default("local-dev-user"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  WEB_BASE_URL: z.string().default("http://localhost:3000"),
  TELEGRAM_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000)
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cachedConfig: AppConfig | null = null;

export const loadConfig = (): AppConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  loadEnvFiles();
  process.env.DATABASE_URL ??= DEFAULT_DATABASE_URL;
  process.env.REDIS_URL ??= DEFAULT_REDIS_URL;

  cachedConfig = ConfigSchema.parse({
    PORT: process.env.PORT,
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    RELAY_PUBLIC_WS_URL: process.env.RELAY_PUBLIC_WS_URL,
    DEFAULT_USER_ID: process.env.DEFAULT_USER_ID,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    WEB_BASE_URL: process.env.WEB_BASE_URL,
    TELEGRAM_POLL_INTERVAL_MS: process.env.TELEGRAM_POLL_INTERVAL_MS
  });

  return cachedConfig;
};
