import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";

import { loadConfig } from "../../config.js";
import { TelemetryService } from "../telemetry/telemetry.service.js";

@Injectable()
export class QueueService {
  private readonly queue?: Queue;

  constructor(private readonly telemetry: TelemetryService) {
    const config = loadConfig();

    try {
      this.queue = new Queue("telegram-notifications", {
        connection: {
          url: config.REDIS_URL
        }
      });
    } catch (error) {
      this.telemetry.warn("Queue disabled", {
        error: error instanceof Error ? error.message : "unknown_error"
      });
    }
  }

  async enqueueTelegramNotification(
    name: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    if (!this.queue) {
      this.telemetry.log("Queue fallback", { name, payload });
      return;
    }

    await this.queue.add(name, payload, {
      removeOnComplete: 50,
      removeOnFail: 50,
      attempts: 3
    });
  }

  async getHealthStatus(): Promise<"ok" | "disabled" | "error"> {
    if (!this.queue) {
      return "disabled";
    }

    try {
      const client = await this.queue.client;
      await client.ping();
      return "ok";
    } catch {
      return "error";
    }
  }
}
