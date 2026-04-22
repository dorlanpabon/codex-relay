import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";

type PersistedConnectorState = {
  connectorId: string;
  pairingToken: string;
  websocketUrl: string;
  updatedAt: string;
};

export const defaultStateFilePath = (): string => {
  const baseDir =
    process.env.LOCALAPPDATA ??
    process.env.APPDATA ??
    join(os.homedir(), ".codex-relay");

  return join(baseDir, "CodexRelay", "connector-state.json");
};

export const readConnectorState = (
  filePath: string
): PersistedConnectorState | null => {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Partial<PersistedConnectorState>;
    if (!raw.connectorId || !raw.pairingToken || !raw.websocketUrl) {
      return null;
    }

    return {
      connectorId: raw.connectorId,
      pairingToken: raw.pairingToken,
      websocketUrl: raw.websocketUrl,
      updatedAt: raw.updatedAt ?? new Date(0).toISOString()
    };
  } catch {
    return null;
  }
};

export const writeConnectorState = (
  filePath: string,
  state: Omit<PersistedConnectorState, "updatedAt">
): void => {
  mkdirSync(dirname(filePath), {
    recursive: true
  });

  writeFileSync(
    filePath,
    JSON.stringify(
      {
        ...state,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );
};
