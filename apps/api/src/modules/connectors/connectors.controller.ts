import { Body, Controller, Get, Headers, Post, Query } from "@nestjs/common";
import { DesktopCommandSchema } from "@codex-relay/contracts";

import { AuthService } from "../auth/auth.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ConnectorHubService } from "./connector-hub.service.js";

@Controller("connectors")
export class ConnectorsController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly connectorHub: ConnectorHubService,
  ) {}

  @Get()
  async listConnectors(@Headers("x-user-id") userHeader?: string) {
    const userId = this.authService.resolveUserId(userHeader);
    return this.prisma.connector.findMany({
      where: {
        ownerId: userId
      },
      include: {
        projects: {
          orderBy: {
            name: "asc"
          }
        }
      },
      orderBy: {
        updatedAt: "desc"
      }
    });
  }

  @Get("desktop/status")
  getDesktopStatus(
    @Headers("x-user-id") userHeader?: string,
    @Query("connectorId") connectorId?: string,
  ) {
    const userId = this.authService.resolveUserId(userHeader);
    return this.connectorHub.getDesktopStatus(userId, connectorId);
  }

  @Post("desktop/commands")
  async dispatchDesktopCommand(
    @Body() body?: unknown,
    @Headers("x-user-id") userHeader?: string,
  ) {
    const userId = this.authService.resolveUserId(userHeader);
    const payload = DesktopCommandSchema.parse(body);
    await this.connectorHub.dispatchDesktopCommand(userId, payload);
    return {
      queued: false,
      ok: true,
    };
  }
}
