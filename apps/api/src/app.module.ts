import { Module } from "@nestjs/common";

import { AuthModule } from "./modules/auth/auth.module.js";
import { CommandsModule } from "./modules/commands/commands.module.js";
import { ConnectorsModule } from "./modules/connectors/connectors.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { PairingModule } from "./modules/pairing/pairing.module.js";
import { PrismaModule } from "./modules/prisma/prisma.module.js";
import { QueueModule } from "./modules/queue/queue.module.js";
import { SessionsModule } from "./modules/sessions/sessions.module.js";
import { TasksModule } from "./modules/tasks/tasks.module.js";
import { TelemetryModule } from "./modules/telemetry/telemetry.module.js";
import { TelegramModule } from "./modules/telegram/telegram.module.js";

@Module({
  imports: [
    AuthModule,
    CommandsModule,
    ConnectorsModule,
    HealthModule,
    PairingModule,
    PrismaModule,
    QueueModule,
    SessionsModule,
    TasksModule,
    TelemetryModule,
    TelegramModule
  ]
})
export class AppModule {}
