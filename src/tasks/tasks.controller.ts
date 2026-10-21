import { ApiReadAvailability } from "../openapi/api-docs";
import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiNotFoundResponse,
  ApiTags,
  ApiConflictResponse,
  ApiServiceUnavailableResponse,
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
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASKS_CREATE)
  @ApiOperation({
    summary: "Create a task",
    description:
      "Requires current tasks.create. The authenticated user becomes creator and execution manager. Optional requestId atomically records a frozen creation receipt; exact retries replay201, changed input conflicts409. Omit requestId for legacy non-idempotent creation. No board link, human assignment or execution starts. After an unknown response, read the same request or retry unchanged.",
  })
  @ApiCreatedResponse({
    description: "Task created in the queued state.",
    type: TaskResponseDto,
  })
  @ApiAuthenticationErrors()
  @ApiValidationErrors()
  @ApiConflictResponse({
    type: ApiErrorResponseDto,
    description: "Request ID reused with different creation input.",
  })
  @ApiServiceUnavailableResponse({
    type: ApiErrorResponseDto,
    description:
      "TASK_CREATION_UNAVAILABLE; an uncertain response does not prove rollback.",
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTaskDto) {
    return this.tasks.create(user.id, user.workspaceId, dto);
  }
  @Get("creations/:requestId")
  @Header("Cache-Control", "no-store")
  @RequirePermissions(Permissions.TASKS_CREATE)
  @ApiOperation({
    summary: "Read your frozen task creation outcome by request ID",
    description:
      "Current OPEN workspace and tasks.create are required; tasks.read is not. Caller/workspace scope is server-derived. Unknown/other-owner requests return404. No query selectors. Frozen initial values are not current task state; receipt lifetime follows the retained task.",
  })
  @ApiOkResponse({ type: TaskResponseDto })
  @ApiParam({
    name: "requestId",
    format: "uuid",
    description: "Your retained task-creation request UUIDv4.",
  })
  @ApiNotFoundResponse({
    type: ApiErrorResponseDto,
    description:
      "Unknown, other-owner or unavailable workspace/task creation request.",
  })
  @ApiAuthenticationErrors()
  @ApiValidationErrors()
  @ApiServiceUnavailableResponse({
    type: ApiErrorResponseDto,
    description: "TASK_CREATION_UNAVAILABLE; retry authorized readback.",
  })
  creation(
    @CurrentUser() user: AuthenticatedUser,
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.tasks.creation(user, requestId, query);
  }
  @Get()
  @ApiReadAvailability()
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
  @ApiReadAvailability()
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
