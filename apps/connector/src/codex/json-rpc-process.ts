import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams, spawnSync } from "node:child_process";

type JsonRpcMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

export const extractJsonRpcMessages = (
  buffer: Buffer,
): { messages: JsonRpcMessage[]; remainder: Buffer } => {
  const messages: JsonRpcMessage[] = [];
  let remainder = buffer;

  while (remainder.length > 0) {
    const headerEnd = remainder.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      break;
    }

    const headerText = remainder.subarray(0, headerEnd).toString("utf8");
    const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) {
      remainder = remainder.subarray(headerEnd + 4);
      continue;
    }

    const contentLength = Number(lengthMatch[1]);
    const totalLength = headerEnd + 4 + contentLength;
    if (remainder.length < totalLength) {
      break;
    }

    const body = remainder.subarray(headerEnd + 4, totalLength).toString("utf8");
    messages.push(JSON.parse(body) as JsonRpcMessage);
    remainder = remainder.subarray(totalLength);
  }

  return { messages, remainder };
};

const encodeJsonRpc = (message: JsonRpcMessage): string => {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
};

export class JsonRpcProcess extends EventEmitter {
  private process?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly commandLine: string) {
    super();
  }

  static detectVersion(commandLine: string): { ready: boolean; version?: string } {
    const [command, args] = JsonRpcProcess.parseCommand(commandLine);
    const result = spawnSync(command, [...args, "--version"], {
      encoding: "utf8"
    });

    if (result.status !== 0) {
      return { ready: false };
    }

    const version = result.stdout.trim() || result.stderr.trim();
    return {
      ready: true,
      ...(version ? { version } : {})
    };
  }

  start(): void {
    if (this.process) {
      return;
    }

    const [command, args] = JsonRpcProcess.parseCommand(this.commandLine);
    const child = spawn(command, [...args, "app-server"], {
      stdio: "pipe"
    });
    this.process = child;

    child.stdout.on("data", (chunk: Uint8Array) => {
      this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
      const { messages, remainder } = extractJsonRpcMessages(this.buffer);
      this.buffer = Buffer.from(remainder);

      for (const message of messages) {
        if (typeof message.id === "number") {
          const pending = this.pending.get(message.id);
          if (pending) {
            this.pending.delete(message.id);
            if (message.error) {
              pending.reject(message.error);
            } else {
              pending.resolve(message.result);
            }
          }
          continue;
        }

        if (message.method) {
          this.emit("notification", message.method, message.params ?? {});
        }
      }
    });

    child.stderr.on("data", (chunk: Uint8Array) => {
      this.emit("stderr", Buffer.from(chunk).toString("utf8"));
    });

    child.on("exit", (code) => {
      this.emit("exit", code);
    });
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.start();

    const id = this.nextId++;
    const payload = encodeJsonRpc({
      id,
      method,
      params
    });

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.process?.stdin.write(payload, "utf8");
    return promise;
  }

  private static parseCommand(commandLine: string): [string, string[]] {
    const parts = commandLine.split(/\s+/).filter(Boolean);
    const [command, ...args] = parts;

    if (!command) {
      throw new Error("CODEX_COMMAND is empty");
    }

    return [command, args];
  }
}
