import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger("CodexRelay");

  log(message: string, payload?: Record<string, unknown>): void {
    this.logger.log(payload ? `${message} ${JSON.stringify(payload)}` : message);
  }

  warn(message: string, payload?: Record<string, unknown>): void {
    this.logger.warn(payload ? `${message} ${JSON.stringify(payload)}` : message);
  }

  error(message: string, payload?: Record<string, unknown>): void {
    this.logger.error(payload ? `${message} ${JSON.stringify(payload)}` : message);
  }
}

