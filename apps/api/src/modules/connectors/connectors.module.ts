import { Module, forwardRef } from "@nestjs/common";

import { CommandsModule } from "../commands/commands.module.js";
import { PairingModule } from "../pairing/pairing.module.js";
import { QueueModule } from "../queue/queue.module.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { ConnectorsController } from "./connectors.controller.js";
import { ConnectorHubService } from "./connector-hub.service.js";

@Module({
  imports: [forwardRef(() => CommandsModule), PairingModule, QueueModule, SessionsModule],
  controllers: [ConnectorsController],
  providers: [ConnectorHubService],
  exports: [ConnectorHubService]
})
export class ConnectorsModule {}
