import { Controller, Get } from "@nestjs/common";

import { loadConfig } from "../../config.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { QueueService } from "../queue/queue.service.js";

@Controller("health")
export class HealthController {
  private readonly config = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService
  ) {}

  @Get()
  async getHealth() {
    let database: "ok" | "error" = "ok";

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "error";
    }

    const redis = await this.queue.getHealthStatus();
    const [connectors, sessions] = await Promise.all([
      this.prisma.connector.count(),
      this.prisma.session.count()
    ]);

    return {
      status:
        database === "ok" && redis !== "error"
          ? "ok"
          : "degraded",
      timestamp: new Date().toISOString(),
      services: {
        api: "ok" as const,
        database,
        redis,
        telegram: this.config.TELEGRAM_BOT_TOKEN ? "configured" : "disabled"
      },
      stats: {
        connectors,
        sessions
      }
    };
  }
}
