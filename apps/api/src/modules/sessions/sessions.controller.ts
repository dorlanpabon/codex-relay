import { Controller, Get, Headers, Param } from "@nestjs/common";

import { AuthService } from "../auth/auth.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SessionsService } from "./sessions.service.js";

@Controller("sessions")
export class SessionsController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionsService: SessionsService,
    private readonly prisma: PrismaService
  ) {}

  @Get()
  async listSessions(@Headers("x-user-id") userHeader?: string) {
    const userId = this.authService.resolveUserId(userHeader);
    return this.prisma.session.findMany({
      where: {
        ownerId: userId
      },
      include: {
        connector: true,
        project: true
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: 25
    });
  }

  @Get(":id")
  async getSession(
    @Param("id") sessionId: string,
    @Headers("x-user-id") userHeader?: string
  ) {
    const userId = this.authService.resolveUserId(userHeader);
    return this.sessionsService.getSession(userId, sessionId);
  }
}
