import {
  ConnectorCommandEnvelopeSchema,
  ConnectorHelloSchema,
  type DesktopStatus,
  type ConnectorEventEnvelope,
  type ConnectorHello,
  type PairRequest,
} from "@codex-relay/contracts";
import WebSocket from "ws";

import { AppServerClient } from "./codex/app-server-client.js";
import { loadConfig } from "./config.js";
import { DesktopCompanion } from "./desktop/companion.js";
import { detectPlatform, discoverProjects } from "./projects.js";
import {
  readConnectorState,
  writeConnectorState,
} from "./state/connector-state.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ConnectorIdentity = {
  connectorId: string;
  pairingToken: string;
  websocketUrl: string;
};

const pairConnector = async (params: {
  apiBaseUrl: string;
  relayUserId: string;
  machineName: string;
  codexVersion: string | undefined;
  appServerReady: boolean;
  projects: PairRequest["projects"];
  stateFilePath: string;
}): Promise<ConnectorIdentity> => {
  const pairPayload: PairRequest = {
    machineName: params.machineName,
    platform: detectPlatform(),
    appServerReady: params.appServerReady,
    projects: params.projects,
    ...(params.codexVersion !== undefined ? { codexVersion: params.codexVersion } : {}),
  };

  const response = await fetch(`${params.apiBaseUrl}/pair`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": params.relayUserId,
    },
    body: JSON.stringify(pairPayload),
  });

  if (!response.ok) {
    throw new Error(`Pairing failed with status ${response.status}`);
  }

  const pairing = (await response.json()) as ConnectorIdentity;
  writeConnectorState(params.stateFilePath, pairing);
  return pairing;
};

const buildHello = (params: {
  connectorId: string;
  machineName: string;
  codexVersion: string | undefined;
  appServerReady: boolean;
  desktopAutomationReady: boolean;
  projects: PairRequest["projects"];
}): ConnectorHello =>
  ConnectorHelloSchema.parse({
    connectorId: params.connectorId,
    machineName: params.machineName,
    platform: detectPlatform(),
    appServerReady: params.appServerReady,
    desktopAutomationReady: params.desktopAutomationReady,
    projects: params.projects,
    ...(params.codexVersion !== undefined ? { codexVersion: params.codexVersion } : {}),
  });

const openSocket = async (
  websocketUrl: string,
  pairingToken: string,
): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(websocketUrl, {
      headers: {
        Authorization: `Bearer ${pairingToken}`,
      },
    });

    socket.once("open", () => resolve(socket));
    socket.once("error", (error) => reject(error));
    socket.once("unexpected-response", (_, response) => {
      reject(new Error(`Unexpected websocket response ${response.statusCode ?? "unknown"}`));
    });
  });

const main = async (): Promise<void> => {
  const config = loadConfig();
  const projects = discoverProjects(config.PROJECTS);
  const codexStatus = AppServerClient.detect(config.CODEX_COMMAND);
  const persistedState = readConnectorState(config.STATE_FILE_PATH);

  let identity: ConnectorIdentity | null =
    config.CONNECTOR_ID && config.PAIRING_TOKEN && config.WEBSOCKET_URL
      ? {
          connectorId: config.CONNECTOR_ID,
          pairingToken: config.PAIRING_TOKEN,
          websocketUrl: config.WEBSOCKET_URL,
        }
      : persistedState;

  if (!identity) {
    identity = await pairConnector({
      apiBaseUrl: config.API_BASE_URL,
      relayUserId: config.RELAY_USER_ID,
      machineName: config.MACHINE_NAME,
      codexVersion: codexStatus.version,
      appServerReady: codexStatus.ready,
      projects,
      stateFilePath: config.STATE_FILE_PATH,
    });
  }

  const getIdentity = (): ConnectorIdentity => {
    if (!identity) {
      throw new Error("Connector identity is not initialized");
    }

    return identity;
  };

  const appServer = new AppServerClient({
    commandLine: config.CODEX_COMMAND,
  });
  const desktopCompanion = config.DESKTOP_AUTOMATION_ENABLED
    ? new DesktopCompanion({
        logsRoot: config.DESKTOP_LOGS_ROOT,
        pollIntervalMs: config.DESKTOP_POLL_INTERVAL_MS,
        defaultMaxAutoTurns: config.DESKTOP_AUTOPILOT_MAX_TURNS,
        windowTitle: config.DESKTOP_WINDOW_TITLE,
        continueMode: config.DESKTOP_CONTINUE_MODE,
      })
    : null;

  let activeSocket: WebSocket | null = null;
  const getDesktopStatus = (): Omit<DesktopStatus, "connectorId" | "connected"> =>
    desktopCompanion?.getStatus() ?? {
      desktopAutomationReady: false,
      autopilotEnabled: false,
      maxAutoTurns: config.DESKTOP_AUTOPILOT_MAX_TURNS,
      autoContinueCount: 0,
      conversations: [],
      note: "Desktop companion deshabilitado.",
    };

  const publish = (socket: WebSocket, envelope: ConnectorEventEnvelope) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(envelope));
    }
  };

  appServer.on("session.event", (payload) => {
    if (activeSocket) {
      publish(activeSocket, {
        type: "session.event",
        payload,
      });
    }
  });

  appServer.on("approval.requested", (payload) => {
    if (activeSocket) {
      publish(activeSocket, {
        type: "approval.requested",
        payload,
      });
    }
  });

  appServer.on("session.snapshot", (payload) => {
    if (activeSocket) {
      const currentIdentity = getIdentity();
      publish(activeSocket, {
        type: "session.snapshot",
        payload: {
          ...payload,
          connectorId: currentIdentity.connectorId,
        },
      });
    }
  });

  desktopCompanion?.on("desktop.status", (payload) => {
    if (!activeSocket) {
      return;
    }

    const currentIdentity = getIdentity();
    publish(activeSocket, {
      type: "desktop.status",
      payload: {
        ...payload,
        connectorId: currentIdentity.connectorId,
        connected: true,
      },
    });
  });

  await desktopCompanion?.start();

  while (true) {
    try {
      const currentIdentity = getIdentity();
      const socket = await openSocket(
        currentIdentity.websocketUrl,
        currentIdentity.pairingToken,
      );
      const hello = buildHello({
        connectorId: currentIdentity.connectorId,
        machineName: config.MACHINE_NAME,
        codexVersion: codexStatus.version,
        appServerReady: codexStatus.ready,
        desktopAutomationReady: getDesktopStatus().desktopAutomationReady,
        projects,
      });

      activeSocket = socket;
      publish(socket, {
        type: "connector.hello",
        payload: hello,
      });
      publish(socket, {
        type: "desktop.status",
        payload: {
          ...getDesktopStatus(),
          connectorId: currentIdentity.connectorId,
          connected: true,
        },
      });

      let closeReason = "socket_closed";
      socket.on("message", async (buffer) => {
        try {
          const envelope = ConnectorCommandEnvelopeSchema.parse(
            JSON.parse(buffer.toString()),
          );

          if (envelope.type === "desktop.command") {
            switch (envelope.payload.command) {
              case "continue_active":
                await desktopCompanion?.continueActive();
                break;
              case "continue_conversation":
                await desktopCompanion?.continueConversation(
                  envelope.payload.conversationId,
                  "manual",
                );
                break;
              case "autopilot_on":
                desktopCompanion?.setAutopilot(true, envelope.payload.maxAutoTurns);
                break;
              case "autopilot_off":
                desktopCompanion?.setAutopilot(false);
                break;
            }
            return;
          }

          if (envelope.type === "task.start") {
            await appServer.startTask(envelope.sessionId, envelope.payload);
            return;
          }

          if (envelope.type === "session.resume") {
            appServer.restoreSession(envelope.sessionId, envelope.payload);
            return;
          }

          switch (envelope.payload.command) {
            case "continue":
              await appServer.continueSession(envelope.sessionId);
              break;
            case "approve_once":
              if (envelope.payload.approvalId && envelope.payload.decision) {
                await appServer.resolveApproval(
                  envelope.sessionId,
                  envelope.payload.approvalId,
                  envelope.payload.decision,
                );
              }
              break;
            case "pause":
              appServer.pauseSession(envelope.sessionId);
              break;
            case "abort":
              await appServer.abortSession(envelope.sessionId);
              break;
            case "resume_thread":
              console.warn(
                "Ignoring session.command resume_thread; expected session.resume envelope.",
              );
              break;
          }
        } catch (error) {
          const currentIdentity = getIdentity();
          publish(socket, {
            type: "connector.error",
            payload: {
              connectorId: currentIdentity.connectorId,
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      });

      await new Promise<void>((resolve) => {
        socket.once("close", (code, reason) => {
          closeReason = `close:${code}${reason.length ? `:${reason.toString()}` : ""}`;
          resolve();
        });
        socket.once("error", (error) => {
          closeReason = `error:${error instanceof Error ? error.message : String(error)}`;
          resolve();
        });
      });

      activeSocket = null;
      console.warn(`Connector websocket reconnecting after ${closeReason}`);
    } catch (error) {
      activeSocket = null;
      const message = error instanceof Error ? error.message : String(error);

      if (
        message.includes("Unexpected websocket response 401") ||
        message.includes("Unexpected websocket response 403")
      ) {
        identity = await pairConnector({
          apiBaseUrl: config.API_BASE_URL,
          relayUserId: config.RELAY_USER_ID,
          machineName: config.MACHINE_NAME,
          codexVersion: codexStatus.version,
          appServerReady: codexStatus.ready,
          projects,
          stateFilePath: config.STATE_FILE_PATH,
        });
        await sleep(config.RECONNECT_DELAY_MS);
        continue;
      }

      console.error(`Connector websocket error: ${message}`);
    }

    await sleep(config.RECONNECT_DELAY_MS);
  }
};

void main();
