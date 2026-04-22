import { Module } from "@nestjs/common";

import { CommandsModule } from "../commands/commands.module.js";
import { ConnectorsModule } from "../connectors/connectors.module.js";
import { TasksController } from "./tasks.controller.js";
import { TasksService } from "./tasks.service.js";

@Module({
  imports: [CommandsModule, ConnectorsModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService]
})
export class TasksModule {}
