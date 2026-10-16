import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiNotFoundResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser, RequirePermissions } from "../auth/auth.decorator";
import { JwtAuthGuard, PermissionsGuard } from "../auth/auth.guards";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  CreateTaskDto,
  TaskResponseDto,
  TaskListItemResponseDto,
  TaskDetailResponseDto,
} from "./tasks.dto";
import { TasksService } from "./tasks.service";
import {
  ApiAccessToken,
  ApiAuthenticationErrors,
  ApiValidationErrors,
  ApiErrorResponseDto,
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
      "Requires tasks.read. Callers with tasks.read-all receive all workspace tasks; other callers receive tasks assigned to them. Each result includes manager fullName and a zero-or-one-element sessions array selected by session createdAt DESC. The summary contains only id, status and createdAt and does not grant session-detail access.",
  })
  @ApiOkResponse({
    description: "Tasks ordered by most recently updated.",
    type: TaskListItemResponseDto,
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
  @Get(":id")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASKS_READ)
  @ApiOperation({
    summary: "Read a visible task by stable identity",
    description:
      "Requires current tasks.read and current workspace scope. Without tasks.read-all, only the assigned manager can read the task; creator identity and project/role labels grant no bypass. Authorization and task projection share one database snapshot. Missing, foreign-workspace and unassigned tasks return the same 404. Returns only existing task fields, manager fullName and the zero-or-one latest-created session summary; this grants no session detail or transcript access.",
  })
  @ApiParam({
    name: "id",
    format: "uuid",
    description: "Existing task UUID (v4).",
  })
  @ApiOkResponse({ type: TaskDetailResponseDto })
  @ApiAuthenticationErrors()
  @ApiValidationErrors()
  @ApiNotFoundResponse({
    type: ApiErrorResponseDto,
    description: "Task not found or outside the caller's task read scope.",
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
  ) {
    return this.tasks.get(user, id);
  }
}
