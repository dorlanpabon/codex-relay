import { Module } from "@nestjs/common";

import { PairingController } from "./pairing.controller.js";
import { PairingService } from "./pairing.service.js";

@Module({
  controllers: [PairingController],
  providers: [PairingService],
  exports: [PairingService]
})
export class PairingModule {}

