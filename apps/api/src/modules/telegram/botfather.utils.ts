const BOT_TOKEN_PATTERN = /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/;
const USERNAME_SUFFIX = "bot";
const MAX_USERNAME_LENGTH = 32;

export const normalizePhoneNumber = (value: string): string => {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) {
    throw new Error("TELEGRAM_CREATOR_PHONE es obligatorio.");
  }

  return `+${digits}`;
};

export const sanitizeBotName = (value: string): string => {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new Error("El nombre del bot no puede estar vacio.");
  }

  return normalized;
};

export const normalizeBotUsername = (value: string): string => {
  const ascii = value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_+/, "");

  let stem = ascii.endsWith(USERNAME_SUFFIX) ? ascii.slice(0, -USERNAME_SUFFIX.length) : ascii;

  if (!stem) {
    stem = "codexrelay";
  }

  if (!/^[a-z]/.test(stem)) {
    stem = `relay${stem}`;
  }

  stem = stem.slice(0, MAX_USERNAME_LENGTH - USERNAME_SUFFIX.length);

  return `${stem}${USERNAME_SUFFIX}`;
};

export const buildUsernameCandidates = (input: {
  preferredUsername?: string;
  botName: string;
  phoneNumber: string;
  count?: number;
}): string[] => {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const total = input.count ?? 8;
  const push = (value: string): void => {
    const normalized = normalizeBotUsername(value);
    if (seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    candidates.push(normalized);
  };

  if (input.preferredUsername) {
    push(input.preferredUsername);
  }

  const seed = normalizePhoneNumber(input.phoneNumber).replace(/\D/g, "").slice(-4) || "relay";
  const baseStem = normalizeBotUsername(input.botName).slice(0, -USERNAME_SUFFIX.length);

  push(`${baseStem}${seed}${USERNAME_SUFFIX}`);

  for (let index = 1; index <= total; index += 1) {
    push(`${baseStem}${seed}${index}${USERNAME_SUFFIX}`);
  }

  return candidates;
};

export const extractBotToken = (value: string): string | null =>
  value.match(BOT_TOKEN_PATTERN)?.[0] ?? null;

export const isUsernameRejected = (value: string): boolean => {
  const normalized = value.toLowerCase();

  return [
    "username is already taken",
    "username is invalid",
    "must end in",
    "please choose a different username",
    "try something different",
    "choose a username"
  ].some((fragment) => normalized.includes(fragment));
};
