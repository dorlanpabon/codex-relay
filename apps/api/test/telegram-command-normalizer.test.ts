import { describe, expect, it } from "vitest";

import { normalizeTelegramCommandInput } from "../src/modules/telegram/command-normalizer.js";

describe("normalizeTelegramCommandInput", () => {
  it("accepts desktop status aliases", () => {
    expect(normalizeTelegramCommandInput("/desktop status connector-1")).toBe(
      "/desktop_status connector-1",
    );
    expect(normalizeTelegramCommandInput("/desktop-status")).toBe("/desktop_status");
    expect(normalizeTelegramCommandInput("/desktop_all")).toBe("/desktop_status all");
    expect(normalizeTelegramCommandInput("/desktop inactive")).toBe("/desktop_status inactive");
  });

  it("accepts desktop continue aliases", () => {
    expect(normalizeTelegramCommandInput("/desktop continue conversation-1")).toBe(
      "/desktop_continue conversation-1",
    );
    expect(normalizeTelegramCommandInput("/DESKTOP_CONTINUE connector-1 conversation-1")).toBe(
      "/desktop_continue connector-1 conversation-1",
    );
  });

  it("accepts desktop inspect aliases", () => {
    expect(normalizeTelegramCommandInput("/desktop inspect 2")).toBe(
      "/desktop_inspect 2",
    );
    expect(normalizeTelegramCommandInput("/DESKTOP-INSPECT agent_dropshipping")).toBe(
      "/desktop_inspect agent_dropshipping",
    );
  });

  it("keeps the rest of run payload intact enough for parsing", () => {
    expect(normalizeTelegramCommandInput('/RUN "D:\\repo" corrige el bug')).toBe(
      '/run "D:\\repo" corrige el bug',
    );
  });
});
