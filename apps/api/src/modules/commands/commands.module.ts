import { Module, forwardRef } from "@nestjs/common";

import { ConnectorsModule } from "../connectors/connectors.module.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { CommandsController } from "./commands.controller.js";
import { CommandsService } from "./commands.service.js";

@Module({
  imports: [SessionsModule, forwardRef(() => ConnectorsModule)],
  controllers: [CommandsController],
  providers: [CommandsService],
  exports: [CommandsService]
})
export class CommandsModule {}
