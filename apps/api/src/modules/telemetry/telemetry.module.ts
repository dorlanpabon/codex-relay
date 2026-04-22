import { Global, Module } from "@nestjs/common";

import { TelemetryService } from "./telemetry.service.js";

@Global()
@Module({
  providers: [TelemetryService],
  exports: [TelemetryService]
})
export class TelemetryModule {}

