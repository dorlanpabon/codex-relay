import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as dotenvConfig } from "dotenv";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let loaded = false;

export const resolveApiPath = (...segments: string[]): string => resolve(apiRoot, ...segments);

export const loadEnvFiles = (): void => {
  if (loaded) {
    return;
  }

  for (const fileName of [".env", ".env.local"]) {
    const filePath = resolveApiPath(fileName);
    if (existsSync(filePath)) {
      dotenvConfig({
        path: filePath,
        override: false
      });
    }
  }

  loaded = true;
};
