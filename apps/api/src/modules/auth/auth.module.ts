import { Global, Module } from "@nestjs/common";

import { AuthService } from "./auth.service.js";

@Global()
@Module({
  providers: [AuthService],
  exports: [AuthService]
})
export class AuthModule {}

