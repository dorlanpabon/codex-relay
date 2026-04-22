import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  readConnectorState,
  writeConnectorState
} from "../src/state/connector-state.js";

describe("connector state store", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, {
        recursive: true,
        force: true
      });
    }
  });

  it("persists and reloads connector identity", () => {
    const tempDir = mkdtempSync(join(os.tmpdir(), "codex-relay-connector-"));
    tempDirs.push(tempDir);
    const filePath = join(tempDir, "connector-state.json");

    writeConnectorState(filePath, {
      connectorId: "connector-1",
      pairingToken: "token-1",
      websocketUrl: "ws://localhost:4000/connectors"
    });

    expect(readConnectorState(filePath)).toMatchObject({
      connectorId: "connector-1",
      pairingToken: "token-1",
      websocketUrl: "ws://localhost:4000/connectors"
    });
  });
});
