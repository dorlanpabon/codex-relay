import { describe, expect, it } from "vitest";

import { extractJsonRpcMessages } from "../src/codex/json-rpc-process.js";

describe("extractJsonRpcMessages", () => {
  it("parses one framed message", () => {
    const body = JSON.stringify({ method: "turn.completed", params: { ok: true } });
    const frame = Buffer.from(
      `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`,
      "utf8",
    );

    const result = extractJsonRpcMessages(frame);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.method).toBe("turn.completed");
    expect(result.remainder.length).toBe(0);
  });
});
