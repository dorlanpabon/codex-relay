import { Injectable } from "@nestjs/common";

import { loadConfig } from "../../config.js";

@Injectable()
export class AuthService {
  private readonly config = loadConfig();

  resolveUserId(headerValue?: string): string {
    return headerValue?.trim() || this.config.DEFAULT_USER_ID;
  }
}

