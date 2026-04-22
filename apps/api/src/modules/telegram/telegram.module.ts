import { Module } from "@nestjs/common";

import { CommandsModule } from "../commands/commands.module.js";
import { ConnectorsModule } from "../connectors/connectors.module.js";
import { TasksModule } from "../tasks/tasks.module.js";
import { TelegramBotService } from "./telegram.service.js";

@Module({
  imports: [CommandsModule, ConnectorsModule, TasksModule],
  providers: [TelegramBotService],
})
export class TelegramModule {}

