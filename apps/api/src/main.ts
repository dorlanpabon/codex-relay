import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cors from "@fastify/cors";

import { AppModule } from "./app.module.js";
import { loadConfig } from "./config.js";
import { ConnectorHubService } from "./modules/connectors/connector-hub.service.js";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false
    })
  );
  const logger = new Logger("Bootstrap");

  await app.register(cors, {
    origin: true
  });

  await app.listen(config.PORT, "0.0.0.0");

  const server = app.getHttpAdapter().getInstance().server;
  const connectorHub = app.get(ConnectorHubService);
  connectorHub.attachServer(server);

  logger.log(`API running on http://localhost:${config.PORT}`);
  logger.log(`Connector WebSocket on ${config.RELAY_PUBLIC_WS_URL}`);
}

void bootstrap();
