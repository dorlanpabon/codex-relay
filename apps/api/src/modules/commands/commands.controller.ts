import { Body, Controller, Headers, Inject, Post, forwardRef } from "@nestjs/common";
import { ControlCommandSchema, type ControlCommand } from "@codex-relay/contracts";

import { AuthService } from "../auth/auth.service.js";
import { ConnectorHubService } from "../connectors/connector-hub.service.js";
import { CommandsService } from "./commands.service.js";

@Controller("commands")
export class CommandsController {
  constructor(
    private readonly authService: AuthService,
    private readonly commandsService: CommandsService,
    @Inject(forwardRef(() => ConnectorHubService))
    private readonly connectorHub: ConnectorHubService
  ) {}

  @Post()
  async createCommand(
    @Body() body: unknown,
    @Headers("x-user-id") userHeader?: string
  ): Promise<{ queued: boolean; command: ControlCommand }> {
    const userId = this.authService.resolveUserId(userHeader);
    const payload = ControlCommandSchema.parse(body);
    const command = await this.commandsService.createUserCommand(userId, payload);
    await this.connectorHub.dispatchQueuedCommand(command.session.connectorId, command);

    return {
      queued: true,
      command: payload
    };
  }
}
