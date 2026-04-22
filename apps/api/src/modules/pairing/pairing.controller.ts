import { Body, Controller, Headers, Post } from "@nestjs/common";
import { PairRequestSchema, type PairResponse } from "@codex-relay/contracts";

import { AuthService } from "../auth/auth.service.js";
import { PairingService } from "./pairing.service.js";

@Controller("pair")
export class PairingController {
  constructor(
    private readonly authService: AuthService,
    private readonly pairingService: PairingService
  ) {}

  @Post()
  async createPairing(
    @Body() body: unknown,
    @Headers("x-user-id") userHeader?: string
  ): Promise<PairResponse> {
    const userId = this.authService.resolveUserId(userHeader);
    const payload = PairRequestSchema.parse(body);
    return this.pairingService.createPairing(userId, payload);
  }
}

