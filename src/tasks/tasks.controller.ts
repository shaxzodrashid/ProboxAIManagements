import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CurrentUser, Roles } from "../auth/auth.decorator";
import { JwtAuthGuard, RolesGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import { CreateTaskDto, TaskResponseDto } from "./tasks.dto";
import { TasksService } from "./tasks.service";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
@Controller("tasks")
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiTags("Tasks")
@ApiAccessToken()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}
  @Post()
  @Roles(UserRole.MANAGER)
  @ApiOperation({
    summary: "Create a task",
    description:
      "Manager-only. The authenticated manager becomes both creator and assignee.",
  })
  @ApiCreatedResponse({
    description: "Task created in the queued state.",
    type: TaskResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiValidationErrors()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTaskDto) {
    return this.tasks.create(user.id, user.workspaceId, dto);
  }
  @Get()
  @ApiOperation({
    summary: "List visible tasks",
    description:
      "Administrators receive all workspace tasks; other users receive tasks assigned to them. Each result includes its manager and most recent session when available.",
  })
  @ApiOkResponse({
    description: "Tasks ordered by most recently updated.",
    type: TaskResponseDto,
    isArray: true,
  })
  @ApiAuthenticationErrors()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.tasks.list(
      user.workspaceId,
      user.id,
      user.role === UserRole.ADMIN,
    );
  }
}
