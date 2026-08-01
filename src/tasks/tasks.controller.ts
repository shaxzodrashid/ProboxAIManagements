import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser, RequirePermissions } from "../auth/auth.decorator";
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import { CreateTaskDto, TaskResponseDto } from "./tasks.dto";
import { TasksService } from "./tasks.service";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiValidationErrors,
} from "../openapi/api-docs";
import {
  hasPermission,
  Permissions,
} from "../authorization/permission.catalog";
@Controller("tasks")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiTags("Tasks")
@ApiAccessToken()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}
  @Post()
  @RequirePermissions(Permissions.TASKS_CREATE)
  @ApiOperation({
    summary: "Create a task",
    description:
      "Requires tasks.create. The authenticated user becomes both creator and assignee.",
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
  @RequirePermissions(Permissions.TASKS_READ)
  @ApiOperation({
    summary: "List visible tasks",
    description:
      "Callers with tasks.read-all receive all workspace tasks; other callers receive tasks assigned to them. Each result includes its manager and most recent session when available.",
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
      hasPermission(user, Permissions.TASKS_READ_ALL),
    );
  }
}
