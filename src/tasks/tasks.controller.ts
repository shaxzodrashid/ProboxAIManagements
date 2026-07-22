import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { CurrentUser, Roles } from "../auth/auth.decorator";
import { JwtAuthGuard, RolesGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import { CreateTaskDto } from "./tasks.dto";
import { TasksService } from "./tasks.service";
@Controller("tasks")
@UseGuards(JwtAuthGuard, RolesGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}
  @Post() @Roles(UserRole.MANAGER) create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasks.create(user.id, user.workspaceId, dto);
  }
  @Get() list(@CurrentUser() user: AuthenticatedUser) {
    return this.tasks.list(
      user.workspaceId,
      user.id,
      user.role === UserRole.ADMIN,
    );
  }
}
