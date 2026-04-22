import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { ConnectorHello, PairRequest, PairResponse } from "@codex-relay/contracts";

import { loadConfig } from "../../config.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class PairingService {
  private readonly config = loadConfig();

  constructor(private readonly prisma: PrismaService) {}

  async createPairing(userId: string, input: PairRequest): Promise<PairResponse> {
    await this.prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId }
    });

    const connectorId = randomUUID();
    const pairingToken = randomBytes(24).toString("hex");

    await this.prisma.connector.create({
      data: {
        id: connectorId,
        ownerId: userId,
        machineName: input.machineName,
        platform: input.platform,
        codexVersion: input.codexVersion ?? null,
        appServerReady: input.appServerReady,
        pairingTokenHash: this.hashToken(pairingToken),
        status: "pending",
        projects: {
          create: input.projects.map((project) => ({
            id: randomUUID(),
            name: project.name,
            repoPath: project.repoPath
          }))
        }
      }
    });

    return {
      connectorId,
      pairingToken,
      websocketUrl: `${this.config.RELAY_PUBLIC_WS_URL}?connectorId=${connectorId}&token=${pairingToken}`,
      expiresAt: new Date(Date.now() + 1000 * 60 * 10).toISOString()
    };
  }

  async validatePairing(connectorId: string, token: string): Promise<string> {
    const connector = await this.prisma.connector.findUnique({
      where: { id: connectorId },
      select: {
        ownerId: true,
        pairingTokenHash: true
      }
    });

    if (!connector || connector.pairingTokenHash !== this.hashToken(token)) {
      throw new UnauthorizedException("Invalid connector token");
    }

    return connector.ownerId;
  }

  async applyHello(ownerId: string, hello: ConnectorHello): Promise<void> {
    await this.prisma.connector.update({
      where: { id: hello.connectorId },
      data: {
        ownerId,
        machineName: hello.machineName,
        platform: hello.platform,
        codexVersion: hello.codexVersion ?? null,
        appServerReady: hello.appServerReady,
        status: "connected",
        lastSeenAt: new Date()
      }
    });

    await this.prisma.project.deleteMany({
      where: {
        connectorId: hello.connectorId,
        repoPath: {
          notIn: hello.projects.map((project) => project.repoPath)
        }
      }
    });

    for (const project of hello.projects) {
      await this.prisma.project.upsert({
        where: {
          connectorId_repoPath: {
            connectorId: hello.connectorId,
            repoPath: project.repoPath
          }
        },
        update: {
          name: project.name,
          repoPath: project.repoPath
        },
        create: {
          id: randomUUID(),
          connectorId: hello.connectorId,
          name: project.name,
          repoPath: project.repoPath
        }
      });
    }
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
