import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as dotenvConfig } from "dotenv";

const connectorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let loaded = false;

export const loadEnvFiles = (): void => {
  if (loaded) {
    return;
  }

  for (const fileName of [".env", ".env.local"]) {
    const filePath = resolve(connectorRoot, fileName);
    if (existsSync(filePath)) {
      dotenvConfig({
        path: filePath,
        override: false
      });
    }
  }

  loaded = true;
};
