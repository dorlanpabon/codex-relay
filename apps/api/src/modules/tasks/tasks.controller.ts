import { Body, Controller, Headers, Post } from "@nestjs/common";

import { AuthService } from "../auth/auth.service.js";
import { TasksService } from "./tasks.service.js";

@Controller("tasks")
export class TasksController {
  constructor(
    private readonly authService: AuthService,
    private readonly tasksService: TasksService
  ) {}

  @Post()
  async createTask(
    @Body() body: unknown,
    @Headers("x-user-id") userHeader?: string
  ) {
    const userId = this.authService.resolveUserId(userHeader);
    return this.tasksService.createTask(userId, body);
  }
}

