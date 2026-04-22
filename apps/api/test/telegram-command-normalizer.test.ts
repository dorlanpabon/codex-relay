import { describe, expect, it } from "vitest";

import { normalizeTelegramCommandInput } from "../src/modules/telegram/command-normalizer.js";

describe("normalizeTelegramCommandInput", () => {
  it("accepts desktop status aliases and common typo", () => {
    expect(normalizeTelegramCommandInput("/DESTKTOP STATUS")).toBe("/desktop_status");
    expect(normalizeTelegramCommandInput("/desktop status connector-1")).toBe(
      "/desktop_status connector-1",
    );
    expect(normalizeTelegramCommandInput("/desktop-status")).toBe("/desktop_status");
  });

  it("accepts desktop continue aliases", () => {
    expect(normalizeTelegramCommandInput("/desktop continue conversation-1")).toBe(
      "/desktop_continue conversation-1",
    );
    expect(normalizeTelegramCommandInput("/DESTKTOP_CONTINUE connector-1 conversation-1")).toBe(
      "/desktop_continue connector-1 conversation-1",
    );
  });

  it("keeps the rest of run payload intact enough for parsing", () => {
    expect(normalizeTelegramCommandInput('/RUN "D:\\repo" corrige el bug')).toBe(
      '/run "D:\\repo" corrige el bug',
    );
  });
});
