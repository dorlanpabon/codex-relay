import { Module } from "@nestjs/common";

import { SessionsController } from "./sessions.controller.js";
import { AutoContinuePolicyService } from "./auto-continue.policy.js";
import { SessionsService } from "./sessions.service.js";

@Module({
  controllers: [SessionsController],
  providers: [AutoContinuePolicyService, SessionsService],
  exports: [SessionsService]
})
export class SessionsModule {}

