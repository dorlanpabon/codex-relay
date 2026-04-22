import { describe, expect, it } from "vitest";

import {
  buildUsernameCandidates,
  extractBotToken,
  normalizeBotUsername,
  normalizePhoneNumber,
} from "../src/modules/telegram/botfather.utils.js";

describe("botfather utils", () => {
  it("normalizes colombian phone numbers to E.164-like format", () => {
    expect(normalizePhoneNumber("5732194443539")).toBe("+5732194443539");
  });

  it("normalizes usernames so they end in bot", () => {
    expect(normalizeBotUsername("Codex Relay")).toBe("codexrelaybot");
  });

  it("builds unique username candidates", () => {
    expect(
      buildUsernameCandidates({
        preferredUsername: "codexrelaybot",
        botName: "Codex Relay",
        phoneNumber: "+5732194443539",
        count: 2
      }),
    ).toEqual(["codexrelaybot", "codexrelay3539bot", "codexrelay35391bot", "codexrelay35392bot"]);
  });

  it("extracts bot tokens from BotFather replies", () => {
    expect(
      extractBotToken(
        "Done! Congratulations on your new bot. Use this token to access the HTTP API: 123456:abc_DEF-ghi12345678901234567890",
      ),
    ).toBe("123456:abc_DEF-ghi12345678901234567890");
  });
});
