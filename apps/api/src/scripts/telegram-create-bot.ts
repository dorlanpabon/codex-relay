import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { Api, TelegramClient } from "telegram";
import { computeCheck } from "telegram/Password.js";
import { StringSession } from "telegram/sessions/index.js";

import { loadEnvFiles, resolveApiPath } from "../env/load-env.js";
import {
  buildUsernameCandidates,
  extractBotToken,
  isUsernameRejected,
  normalizePhoneNumber,
  sanitizeBotName,
} from "../modules/telegram/botfather.utils.js";
import { TELEGRAM_BOT_COMMANDS } from "../modules/telegram/telegram-bot-commands.js";

const BOTFATHER = "BotFather";
const DEFAULT_BOT_NAME = "Codex Relay Bot";
const BOTFATHER_TIMEOUT_MS = 20000;
type CliOptions = {
  phone?: string;
  botName?: string;
  botUsername?: string;
  phoneCode?: string;
  password?: string;
  forceLogin: boolean;
  requestCode: boolean;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type PendingAuthInput = {
  client: TelegramClient;
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  phoneCodeHash: string;
  phoneCode: string;
  password: string | undefined;
};

type BotFatherReply = {
  id: number;
  text: string;
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    forceLogin: false,
    requestCode: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) {
      continue;
    }

    if (argument === "--force-login") {
      options.forceLogin = true;
      continue;
    }

    if (argument === "--request-code") {
      options.requestCode = true;
      continue;
    }

    const [key, inlineValue] = argument.split("=", 2);
    const nextValue = inlineValue ?? argv[index + 1];
    const consumeNext = inlineValue === undefined;

    switch (key) {
      case "--phone":
        if (nextValue !== undefined) {
          options.phone = nextValue;
        }
        if (consumeNext) {
          index += 1;
        }
        break;
      case "--bot-name":
        if (nextValue !== undefined) {
          options.botName = nextValue;
        }
        if (consumeNext) {
          index += 1;
        }
        break;
      case "--bot-username":
        if (nextValue !== undefined) {
          options.botUsername = nextValue;
        }
        if (consumeNext) {
          index += 1;
        }
        break;
      case "--code":
        if (nextValue !== undefined) {
          options.phoneCode = nextValue;
        }
        if (consumeNext) {
          index += 1;
        }
        break;
      case "--password":
        if (nextValue !== undefined) {
          options.password = nextValue;
        }
        if (consumeNext) {
          index += 1;
        }
        break;
      default:
        break;
    }
  }

  return options;
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const upsertEnvFile = (filePath: string, values: Record<string, string>): void => {
  const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let content = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const matcher = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");

    if (matcher.test(content)) {
      content = content.replace(matcher, line);
      continue;
    }

    content = content.trimEnd();
    content = content ? `${content}\n${line}\n` : `${line}\n`;
  }

  writeFileSync(filePath, content, "utf8");
};

const telegramBotApi = async <T>(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> => {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as TelegramApiResponse<T>;

  if (!response.ok || !data.ok || data.result === undefined) {
    throw new Error(data.description ?? `Telegram Bot API fallo en ${method}.`);
  }

  return data.result;
};

const getApiCredentials = (apiId: number, apiHash: string): { apiId: number; apiHash: string } => ({
  apiId,
  apiHash
});

const finalizeUserLogin = async (input: PendingAuthInput): Promise<void> => {
  try {
    await input.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: input.phoneNumber,
        phoneCodeHash: input.phoneCodeHash,
        phoneCode: input.phoneCode
      }),
    );
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("SESSION_PASSWORD_NEEDED")) {
      throw error;
    }
  }

  if (!input.password) {
    throw new Error("La cuenta tiene 2FA. Enviame esa clave y sigo.");
  }

  const passwordConfig = await input.client.invoke(new Api.account.GetPassword());
  const passwordCheck = await computeCheck(passwordConfig, input.password);

  await input.client.invoke(
    new Api.auth.CheckPassword({
      password: passwordCheck
    }),
  );
};

const getLastIncomingBotFatherMessageId = async (client: TelegramClient): Promise<number> => {
  const messages = await client.getMessages(BOTFATHER, {
    limit: 5
  });

  return messages.reduce((highest, message) => {
    if (message.out || typeof message.id !== "number") {
      return highest;
    }

    return Math.max(highest, message.id);
  }, 0);
};

const waitForBotFatherReply = async (
  client: TelegramClient,
  afterId: number,
  timeoutMs = BOTFATHER_TIMEOUT_MS,
): Promise<BotFatherReply> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const messages = await client.getMessages(BOTFATHER, {
      limit: 5
    });
    const candidate = messages.find(
      (message) => !message.out && typeof message.id === "number" && message.id > afterId,
    );

    if (candidate) {
      return {
        id: candidate.id,
        text: typeof candidate.text === "string" ? candidate.text : ""
      };
    }

    await sleep(1000);
  }

  throw new Error("BotFather no respondio a tiempo.");
};

const sendAndWaitForBotFather = async (
  client: TelegramClient,
  message: string,
  afterId: number,
  optional = false,
): Promise<BotFatherReply | null> => {
  await client.sendMessage(BOTFATHER, {
    message
  });

  try {
    return await waitForBotFatherReply(client, afterId);
  } catch (error) {
    if (optional) {
      return null;
    }

    throw error;
  }
};

const configureBot = async (botToken: string): Promise<void> => {
  await telegramBotApi(botToken, "getMe", {});
  await telegramBotApi(botToken, "setMyCommands", {
    commands: TELEGRAM_BOT_COMMANDS
  });
  await telegramBotApi(botToken, "setMyDescription", {
    description: "Control remoto de sesiones locales de Codex Relay."
  });
  await telegramBotApi(botToken, "setMyShortDescription", {
    short_description: "Controla Codex Relay desde Telegram."
  });
};

async function main(): Promise<void> {
  loadEnvFiles();

  const options = parseArgs(process.argv.slice(2));
  const apiIdRaw = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;

  if (!apiIdRaw || !apiHash) {
    throw new Error(
      "Faltan TELEGRAM_API_ID y TELEGRAM_API_HASH. Cargalos en apps/api/.env.local o exportalos antes de correr el script.",
    );
  }

  const apiId = Number(apiIdRaw);
  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new Error("TELEGRAM_API_ID debe ser un entero positivo.");
  }

  const defaultPhone = options.phone ?? process.env.TELEGRAM_CREATOR_PHONE;
  const defaultBotName = options.botName ?? process.env.TELEGRAM_BOT_NAME ?? DEFAULT_BOT_NAME;
  const defaultBotUsername = options.botUsername ?? process.env.TELEGRAM_BOT_USERNAME;
  const pendingPhoneCodeHash = process.env.TELEGRAM_CREATOR_PENDING_PHONE_CODE_HASH;
  const pendingPhoneNumber = process.env.TELEGRAM_CREATOR_PENDING_PHONE;
  const pendingSession = process.env.TELEGRAM_CREATOR_PENDING_SESSION;
  const envLocalPath = resolveApiPath(".env.local");

  const rawPhone = defaultPhone;
  if (!rawPhone) {
    throw new Error("Falta TELEGRAM_CREATOR_PHONE o --phone.");
  }

  const phoneNumber = normalizePhoneNumber(rawPhone);
  const botName = sanitizeBotName(defaultBotName);
    const sessionString =
      options.forceLogin ? "" : (pendingSession ?? process.env.TELEGRAM_CREATOR_SESSION ?? "");
    const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
      connectionRetries: 5
    });

  try {
    await client.connect();

    if (!(await client.checkAuthorization())) {
      const credentials = getApiCredentials(apiId, apiHash);

      if (options.requestCode || !options.phoneCode) {
        const sentCode = await client.sendCode(credentials, phoneNumber);

        upsertEnvFile(envLocalPath, {
          TELEGRAM_API_ID: String(apiId),
          TELEGRAM_API_HASH: apiHash,
          TELEGRAM_CREATOR_PHONE: phoneNumber,
          TELEGRAM_CREATOR_PENDING_PHONE: phoneNumber,
          TELEGRAM_CREATOR_PENDING_PHONE_CODE_HASH: sentCode.phoneCodeHash,
          TELEGRAM_CREATOR_PENDING_SESSION: String(client.session.save())
        });

        console.log(
          sentCode.isCodeViaApp
            ? "Telegram envio el codigo dentro de la app."
            : "Telegram envio el codigo por SMS.",
        );
        console.log("Enviame el OTP y ejecuto la segunda fase.");
        return;
      }

      const authPhone = pendingPhoneNumber ?? phoneNumber;
      const authHash = pendingPhoneCodeHash;
      if (!authHash) {
        throw new Error("No existe un phoneCodeHash pendiente. Primero debo pedir el codigo.");
      }

      await finalizeUserLogin({
        client,
        apiId,
        apiHash,
        phoneNumber: authPhone,
        phoneCodeHash: authHash,
        phoneCode: options.phoneCode,
        password: options.password
      });
    }

    const savedSession = client.session.save();
    let lastReplyId = await getLastIncomingBotFatherMessageId(client);
    const cancelReply = await sendAndWaitForBotFather(client, "/cancel", lastReplyId, true);
    if (cancelReply) {
      lastReplyId = cancelReply.id;
    }

    const nameReply = await sendAndWaitForBotFather(client, "/newbot", lastReplyId);
    if (!nameReply) {
      throw new Error("BotFather no acepto /newbot.");
    }
    lastReplyId = nameReply.id;

    const usernamePrompt = await sendAndWaitForBotFather(client, botName, lastReplyId);
    if (!usernamePrompt) {
      throw new Error("BotFather no pidio username.");
    }
    lastReplyId = usernamePrompt.id;

    const usernameCandidates = buildUsernameCandidates(
      defaultBotUsername
        ? {
            preferredUsername: defaultBotUsername,
            botName,
            phoneNumber
          }
        : {
            botName,
            phoneNumber
          },
    );

    let botToken: string | null = null;
    let botUsername: string | null = null;

    for (const candidate of usernameCandidates) {
      const reply = await sendAndWaitForBotFather(client, candidate, lastReplyId);
      if (!reply) {
        continue;
      }

      lastReplyId = reply.id;
      const maybeToken = extractBotToken(reply.text);

      if (maybeToken) {
        botToken = maybeToken;
        botUsername = candidate;
        break;
      }

      if (!isUsernameRejected(reply.text)) {
        throw new Error(`BotFather devolvio una respuesta inesperada: ${reply.text}`);
      }
    }

    if (!botToken || !botUsername) {
      throw new Error("No fue posible conseguir un username disponible para el bot.");
    }

    let commandsConfigured = true;
    try {
      await configureBot(botToken);
    } catch (error) {
      commandsConfigured = false;
      console.warn(`No pude registrar comandos automaticamente: ${String(error)}`);
    }

    upsertEnvFile(envLocalPath, {
      TELEGRAM_API_ID: String(apiId),
      TELEGRAM_API_HASH: apiHash,
      TELEGRAM_BOT_TOKEN: botToken,
      TELEGRAM_BOT_NAME: botName,
      TELEGRAM_BOT_USERNAME: botUsername,
      TELEGRAM_CREATOR_PHONE: phoneNumber,
      TELEGRAM_CREATOR_SESSION: String(savedSession),
      TELEGRAM_CREATOR_PENDING_PHONE: "",
      TELEGRAM_CREATOR_PENDING_PHONE_CODE_HASH: "",
      TELEGRAM_CREATOR_PENDING_SESSION: ""
    });

    console.log(`Bot creado: @${botUsername}`);
    console.log(`Token guardado en ${envLocalPath}`);
    console.log(
      commandsConfigured
        ? "Comandos Telegram registrados."
        : "El bot quedo creado, pero la configuracion automatica de comandos fallo.",
    );
    console.log("Siguiente paso: inicia el API y envia /start al bot.");
  } finally {
    await client.disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
